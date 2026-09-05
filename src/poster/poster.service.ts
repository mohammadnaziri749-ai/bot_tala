import { Injectable } from '@nestjs/common';

@Injectable()
export class PosterService {
  async generatePricePoster(data: any): Promise<string> {
    const dateFa = new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' });
    
    let message = `💰 *گزارش لحظه‌ای بازار* 💰\n📅 ${dateFa}\n\n`;

    if (data.gold && data.gold.length > 0) {
      message += `🔸 *طلا و سکه:*\n`;
      data.gold.slice(0, 5).forEach((item: any) => {
        message += `▫️ ${item.symbol}: ${Number(item.price).toLocaleString('fa-IR')} ریال\n`;
      });
    }

    if (data.currency && data.currency.length > 0) {
      message += `\n🔹 *ارزها:*\n`;
      data.currency.slice(0, 5).forEach((item: any) => {
        message += `▫️ ${item.symbol}: ${Number(item.price).toLocaleString('fa-IR')} ریال\n`;
      });
    }

    message += `\n🆔 @atabak_gold`;
    return message;
  }
}
