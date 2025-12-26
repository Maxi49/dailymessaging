const makeWASocket = require('@whiskeysockets/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log('Escaneá el QR con tu WhatsApp');
      qrcode.generate(qr, { small: true });
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
    const ahora = new Date();
    const objetivo = new Date();
    objetivo.setHours(22, 30, 0, 0); // Tu hora
    
    if (ahora > objetivo) {
      objetivo.setDate(objetivo.getDate() + 1);
    }
    
    const tiempoHasta = objetivo.getTime() - ahora.getTime();
    
    setTimeout(async () => {
      const numero = process.env.PHONE_NUMBER + '@s.whatsapp.net';
      const mensaje = mensajes[Math.floor(Math.random() * mensajes.length)];
      
      try {
        await sock.sendMessage(numero, { text: mensaje });
        console.log('Mensaje enviado!', new Date().toLocaleString());
      } catch (error) {
        console.error('Error:', error);
      }
      
      programar();
    }, tiempoHasta);
    
    console.log(`Mensaje programado para: ${objetivo.toLocaleString()}`);
  }
  
  programar();
}

connectToWhatsApp();