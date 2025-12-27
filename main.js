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

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

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
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexión cerrada, reconectando...', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('Bot listo!');
      programarMensajeDiario(sock);
    }
  });
}

function programarMensajeDiario(sock) {
  const mensajes = [
    'Recordá tomar la pastilla mi amor ❤️',
    'La pastillita mi amor 💕',
    'Pastillita del día mi my love 💘',
    'No te olvides la pastilla mi chiquita hermosa y preciosa 💖',
  ];

  function programar() {
    // Obtener la hora actual en Argentina (UTC-3)
    const ahora = new Date();
    const ahoraArgentina = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));

    // Crear objetivo para las 22:30 en Argentina
    const objetivo = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
    objetivo.setHours(22, 30, 0, 0);

    // Si ya pasó las 22:30 de hoy, programar para mañana
    if (ahoraArgentina > objetivo) {
      objetivo.setDate(objetivo.getDate() + 1);
    }

    // Calcular el tiempo hasta el envío
    const tiempoHasta = objetivo.getTime() - ahoraArgentina.getTime();

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
  }

  programar();
}

connectToWhatsApp();