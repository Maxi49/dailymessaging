require('dotenv').config();
const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const cloudinary = require('cloudinary').v2;

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Variables globales para control del socket
let currentSock = null;
let isSocketOpen = false;
let shouldAutoReconnect = true; // Controla si debe reconectar automáticamente

// Horarios de conexión (hora Argentina, UTC-3)
const HORA_ABRIR = { hora: 22, minuto: 25 };  // 22:25 Argentina = 01:25 UTC
const HORA_CERRAR = { hora: 22, minuto: 35 }; // 22:35 Argentina = 01:35 UTC

/**
 * Obtiene la hora actual en Argentina
 */
function getArgentinaTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
}

/**
 * Calcula milisegundos hasta una hora específica de Argentina
 */
function getMsUntilArgentinaTime(hora, minuto) {
  const ahora = new Date();
  
  // Crear fecha objetivo en UTC (Argentina = UTC-3)
  const objetivo = new Date();
  objetivo.setUTCHours(hora + 3, minuto, 0, 0); // Convertir hora Argentina a UTC
  
  // Si ya pasó la hora objetivo de hoy, programar para mañana
  if (ahora.getTime() >= objetivo.getTime()) {
    objetivo.setUTCDate(objetivo.getUTCDate() + 1);
  }
  
  return objetivo.getTime() - ahora.getTime();
}

/**
 * Abre el socket de WhatsApp
 */
async function openSocket() {
  if (isSocketOpen) {
    console.log('El socket ya está abierto.');
    return currentSock;
  }

  console.log('='.repeat(60));
  console.log('Abriendo socket...');
  console.log('Hora Argentina:', getArgentinaTime().toLocaleString('es-AR'));
  console.log('='.repeat(60));

  shouldAutoReconnect = true;
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        // Guardar QR localmente
        await qrcode.toFile('./qr.png', qr);
        
        // Subir a Cloudinary
        const result = await cloudinary.uploader.upload('./qr.png', {
          folder: 'whatsapp-bot',
          public_id: 'qr-' + Date.now()
        });
        
        console.log('='.repeat(60));
        console.log('QR CODE URL:');
        console.log(result.secure_url);
        console.log('='.repeat(60));
        console.log('Abrí ese link y escaneá el QR!');
        console.log('='.repeat(60));
      } catch (error) {
        console.error('Error subiendo QR:', error.message);
      }
    }

    if (connection === 'close') {
      isSocketOpen = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      
      console.log('Conexión cerrada. StatusCode:', statusCode, 'LoggedOut:', isLoggedOut);
      
      // Solo reconectar si no fue logout Y si shouldAutoReconnect está activo
      if (!isLoggedOut && shouldAutoReconnect) {
        console.log('Reconectando automáticamente...');
        openSocket();
      } else if (!shouldAutoReconnect) {
        console.log('Socket cerrado intencionalmente. No se reconectará.');
      }
    } else if (connection === 'open') {
      isSocketOpen = true;
      console.log('='.repeat(60));
      console.log('Socket abierto y listo!');
      console.log('Hora Argentina:', getArgentinaTime().toLocaleString('es-AR'));
      console.log('='.repeat(60));
      
      // Programar el mensaje diario
      programarMensajeDiario(sock);
      
      // Programar el cierre del socket a las 22:35
      programarCierreSocket();
    }
  });

  return sock;
}

/**
 * Cierra el socket sin hacer logout
 */
function closeSocket() {
  if (!isSocketOpen || !currentSock) {
    console.log('El socket ya está cerrado.');
    return;
  }

  console.log('='.repeat(60));
  console.log('Cerrando socket...');
  console.log('Hora Argentina:', getArgentinaTime().toLocaleString('es-AR'));
  console.log('='.repeat(60));

  // Desactivar reconexión automática antes de cerrar
  shouldAutoReconnect = false;
  
  // Cerrar el socket sin hacer logout
  currentSock.end();
  currentSock = null;
  isSocketOpen = false;

  console.log('Socket cerrado correctamente. La sesión de WhatsApp sigue activa.');
  
  // Programar la próxima apertura del socket
  programarAperturaSocket();
}

/**
 * Programa la apertura del socket a las 22:25 Argentina
 */
function programarAperturaSocket() {
  const msHastaAbrir = getMsUntilArgentinaTime(HORA_ABRIR.hora, HORA_ABRIR.minuto);
  
  const horasHastaAbrir = Math.floor(msHastaAbrir / 1000 / 60 / 60);
  const minutosHastaAbrir = Math.floor((msHastaAbrir / 1000 / 60) % 60);
  
  console.log(`Próxima apertura de socket: ${HORA_ABRIR.hora}:${HORA_ABRIR.minuto.toString().padStart(2, '0')} (hora Argentina)`);
  console.log(`Tiempo hasta apertura: ${horasHastaAbrir} horas y ${minutosHastaAbrir} minutos`);

  setTimeout(() => {
    openSocket();
  }, msHastaAbrir);
}

/**
 * Programa el cierre del socket a las 22:35 Argentina
 */
function programarCierreSocket() {
  const msHastaCerrar = getMsUntilArgentinaTime(HORA_CERRAR.hora, HORA_CERRAR.minuto);
  
  // Solo programar si el cierre es en menos de 24 horas (o sea, es hoy)
  // Esto evita programar el cierre para mañana cuando acabamos de abrir
  const minutosHastaCerrar = msHastaCerrar / 1000 / 60;
  
  if (minutosHastaCerrar <= 60) { // Si el cierre es en menos de 1 hora
    console.log(`Socket se cerrará a las ${HORA_CERRAR.hora}:${HORA_CERRAR.minuto.toString().padStart(2, '0')} (hora Argentina)`);
    console.log(`Tiempo hasta cierre: ${Math.floor(minutosHastaCerrar)} minutos`);

    setTimeout(() => {
      closeSocket();
    }, msHastaCerrar);
  }
}

function programarMensajeDiario(sock) {
  const mensajes = [
    'Recordá tomar la pastilla mi amor ❤️',
    'La pastillita mi amor 💕',
    'Pastillita del día mi my love 💘',
    'No te olvides la pastilla mi chiquita hermosa y preciosa 💖',
  ];

  function programar() {
    // Obtener la hora actual
    const ahora = new Date();

    // Crear la fecha objetivo para las 22:30 hora Argentina
    // Argentina está en UTC-3, entonces 22:30 ART = 01:30 UTC del día siguiente
    const objetivo = new Date();
    objetivo.setUTCHours(1, 30, 0, 0); // 22:30 Argentina = 01:30 UTC

    // Si ya pasó la hora objetivo de hoy, programar para mañana
    if (ahora.getTime() >= objetivo.getTime()) {
      objetivo.setUTCDate(objetivo.getUTCDate() + 1);
    }

    // Calcular el tiempo hasta el envío
    const tiempoHasta = objetivo.getTime() - ahora.getTime();

    setTimeout(async () => {
      const numero = process.env.PHONE_NUMBER + '@s.whatsapp.net';
      const mensaje = mensajes[Math.floor(Math.random() * mensajes.length)];

      try {
        await sock.sendMessage(numero, { text: mensaje });
        const horaEnvio = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
        console.log('Mensaje enviado!', horaEnvio);
      } catch (error) {
        console.error('Error:', error);
      }

      programar();
    }, tiempoHasta);

    const horaObjetivo = objetivo.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
    console.log(`Mensaje programado para: ${horaObjetivo} (hora Argentina)`);
    console.log(`Tiempo hasta envío: ${Math.floor(tiempoHasta / 1000 / 60 / 60)} horas y ${Math.floor((tiempoHasta / 1000 / 60) % 60)} minutos`);
  }

  programar();
}

/**
 * Función principal - Inicia el sistema de gestión de socket programado
 * Abre el socket al inicio para permitir escanear el QR, luego sigue el horario programado
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Sistema de WhatsApp Bot con Socket Programado');
  console.log('='.repeat(60));
  console.log(`Horario de conexión: ${HORA_ABRIR.hora}:${HORA_ABRIR.minuto.toString().padStart(2, '0')} - ${HORA_CERRAR.hora}:${HORA_CERRAR.minuto.toString().padStart(2, '0')} (Argentina)`);
  console.log('Hora actual Argentina:', getArgentinaTime().toLocaleString('es-AR'));
  console.log('='.repeat(60));

  // Siempre abrir el socket al inicio para permitir escanear QR si es necesario
  console.log('Abriendo socket para verificar/establecer sesión...');
  await openSocket();

  // Esperar a que la conexión se establezca
  await new Promise(resolve => setTimeout(resolve, 5000));

  const argentinaTime = getArgentinaTime();
  const horaActual = argentinaTime.getHours();
  const minutoActual = argentinaTime.getMinutes();

  // Verificar si estamos dentro del horario de conexión (22:25 - 22:35)
  const dentroDeHorario = 
    (horaActual === HORA_ABRIR.hora && minutoActual >= HORA_ABRIR.minuto && minutoActual < HORA_CERRAR.minuto) ||
    (horaActual === HORA_CERRAR.hora && minutoActual < HORA_CERRAR.minuto && HORA_ABRIR.hora !== HORA_CERRAR.hora);

  if (dentroDeHorario) {
    console.log('Estamos dentro del horario de conexión. Socket permanece abierto.');
  } else {
    console.log('Fuera del horario de conexión.');
    console.log('Cerrando socket y esperando próximo horario programado...');
    // Dar tiempo para escanear QR si es necesario (30 segundos)
    console.log('Esperando 30 segundos por si necesitas escanear el QR...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    closeSocket();
  }
}

main();