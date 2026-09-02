type VehicleNotification = {
  vehicleCode: string;
  make: string;
  model: string;
  registrationNumber: string;
  hostName: string;
  hostPhone: string;
  city: string;
};

export async function sendVehicleAddedTelegramNotification(notification: VehicleNotification) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram notification skipped: configuration missing');
    return;
  }

  const text = [
    'New host vehicle submitted',
    `Car: ${notification.make} ${notification.model}`,
    `Registration: ${notification.registrationNumber}`,
    `Vehicle code: ${notification.vehicleCode}`,
    `City: ${notification.city || 'N/A'}`,
    `Host: ${notification.hostName}`,
    `Phone: +${notification.hostPhone}`,
    'Status: Awaiting admin pricing and activation',
  ].join('\n');

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!response.ok) console.error('Telegram notification failed:', response.status);
  } catch (error) {
    console.error('Telegram notification error:', error);
  }
}
