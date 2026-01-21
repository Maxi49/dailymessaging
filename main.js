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

const ARG_TZ = 'America/Argentina/Buenos_Aires';
const ARG_UTC_OFFSET_HOURS = -3;

// Variables globales para control del socket
let currentSock = null;
let isSocketOpen = false;
let shouldAutoReconnect = true; // Controla si debe reconectar automáticamente
let openTimeoutId = null;
let closeTimeoutId = null;
let messageTimeoutId = null;

// Horarios de conexión (hora Argentina, UTC-3)
// Socket abre 22:25, Mensaje 22:30, Socket cierra 22:35
const HORA_ABRIR = { hora: 22, minuto: 25 };  // 22:25 Argentina
const HORA_MENSAJE = { hora: 22, minuto: 30 }; // 22:30 Argentina
const HORA_CERRAR = { hora: 22, minuto: 35 }; // 22:35 Argentina

/**
 * Obtiene la hora actual en Argentina (UTC-3)
 */
function getArgentinaTimeString() {
  return new Date().toLocaleString('es-AR', { timeZone: ARG_TZ });
}

function getArgentinaTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ARG_TZ,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  let hour = 0;
  let minute = 0;

  for (const part of parts) {
    if (part.type === 'hour') {
      hour = Number(part.value);
    } else if (part.type === 'minute') {
      minute = Number(part.value);
    }
  }

  return { hour, minute };
}

/**
 * Calcula milisegundos hasta una hora específica de Argentina
 * Usa un método robusto que evita problemas con overflow de horas
 */
function getMsUntilArgentinaTime(hora, minuto) {
  const ahora = new Date();
  const objetivoUTC = new Date(ahora);
  const utcHour = hora - ARG_UTC_OFFSET_HOURS;

  objetivoUTC.setUTCHours(utcHour, minuto, 0, 0);

  // Si ya paso la hora objetivo hoy (en Argentina), programar para manana
  if (objetivoUTC.getTime() <= ahora.getTime()) {
    objetivoUTC.setUTCDate(objetivoUTC.getUTCDate() + 1);
  }

  return objetivoUTC.getTime() - ahora.getTime();
}

function clearScheduledTimeout(timeoutId) {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
  }
  return null;
}

/**
 * Abre el socket de WhatsApp
 */
async function openSocket() {
  openTimeoutId = clearScheduledTimeout(openTimeoutId);
  if (isSocketOpen) {
    console.log('El socket ya está abierto.');
    return currentSock;
  }

  console.log('='.repeat(60));
  console.log('Abriendo socket...');
  console.log('Hora Argentina:', getArgentinaTimeString());
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
      messageTimeoutId = clearScheduledTimeout(messageTimeoutId);
      closeTimeoutId = clearScheduledTimeout(closeTimeoutId);
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
      console.log('Hora Argentina:', getArgentinaTimeString());
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
 * Usa sock.ws.close() en lugar de sock.end() para preservar las credenciales
 */
function closeSocket() {
  if (!currentSock) {
    console.log('El socket ya está cerrado.');
    return;
  }

  console.log('='.repeat(60));
  console.log('Cerrando socket (preservando sesión)...');
  console.log('Hora Argentina:', getArgentinaTimeString());
  console.log('='.repeat(60));

  // Desactivar reconexión automática antes de cerrar
  shouldAutoReconnect = false;
  messageTimeoutId = clearScheduledTimeout(messageTimeoutId);
  closeTimeoutId = clearScheduledTimeout(closeTimeoutId);
  
  try {
    // Cerrar solo el WebSocket, NO usar sock.end() que puede invalidar la sesión
    // sock.ws.close() cierra la conexión pero mantiene las credenciales válidas
    if (currentSock.ws) {
      currentSock.ws.close();
    }
  } catch (error) {
    console.log('Error al cerrar WebSocket:', error.message);
  }
  
  currentSock = null;
  isSocketOpen = false;

  console.log('Socket cerrado correctamente. La sesión de WhatsApp sigue activa.');
  console.log('Las credenciales están guardadas en auth_info_baileys/');
  
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

  openTimeoutId = clearScheduledTimeout(openTimeoutId);
  openTimeoutId = setTimeout(() => {
    openTimeoutId = null;
    openSocket();
  }, msHastaAbrir);
}

/**
 * Programa el cierre del socket a las 22:35 Argentina
 */
function programarCierreSocket() {
  const msHastaCerrar = getMsUntilArgentinaTime(HORA_CERRAR.hora, HORA_CERRAR.minuto);
  closeTimeoutId = clearScheduledTimeout(closeTimeoutId);
  
  // Solo programar si el cierre es en menos de 24 horas (o sea, es hoy)
  // Esto evita programar el cierre para mañana cuando acabamos de abrir
  const minutosHastaCerrar = msHastaCerrar / 1000 / 60;
  
  if (minutosHastaCerrar <= 60) { // Si el cierre es en menos de 1 hora
    console.log(`Socket se cerrará a las ${HORA_CERRAR.hora}:${HORA_CERRAR.minuto.toString().padStart(2, '0')} (hora Argentina)`);
    console.log(`Tiempo hasta cierre: ${Math.floor(minutosHastaCerrar)} minutos`);

    closeTimeoutId = setTimeout(() => {
      closeTimeoutId = null;
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

  const tiempoHasta = getMsUntilArgentinaTime(HORA_MENSAJE.hora, HORA_MENSAJE.minuto);
  messageTimeoutId = clearScheduledTimeout(messageTimeoutId);
  messageTimeoutId = setTimeout(async () => {
    messageTimeoutId = null;
    const numero = process.env.PHONE_NUMBER + '@s.whatsapp.net';
    const mensaje = mensajes[Math.floor(Math.random() * mensajes.length)];

    if (!isSocketOpen) {
      console.log('Socket cerrado. Se omite el envio de mensaje.');
      return;
    }

    try {
      await sock.sendMessage(numero, { text: mensaje });
      const horaEnvio = new Date().toLocaleString('es-AR', { timeZone: ARG_TZ });
      console.log('Mensaje enviado!', horaEnvio);
    } catch (error) {
      console.error('Error:', error);
    }
  }, tiempoHasta);

  console.log(`Mensaje programado para: ${HORA_MENSAJE.hora}:${HORA_MENSAJE.minuto.toString().padStart(2, '0')} (hora Argentina)`);
  console.log(`Tiempo hasta envio: ${Math.floor(tiempoHasta / 1000 / 60 / 60)} horas y ${Math.floor((tiempoHasta / 1000 / 60) % 60)} minutos`);
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
  console.log('Hora actual Argentina:', getArgentinaTimeString());
  console.log('='.repeat(60));

  // Siempre abrir el socket al inicio para permitir escanear QR si es necesario
  console.log('Abriendo socket para verificar/establecer sesión...');
  await openSocket();

  // Esperar a que la conexión se establezca
  await new Promise(resolve => setTimeout(resolve, 5000));

  const { hour: horaActual, minute: minutoActual } = getArgentinaTimeParts();

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
