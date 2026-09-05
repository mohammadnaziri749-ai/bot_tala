import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import FormData from 'form-data';
import { Readable } from 'stream';

@Injectable()
export class BaleService {
  private readonly logger = new Logger(BaleService.name);
  private readonly PHOTO_TIMEOUT = 40000;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private getUrls() {
    const baleToken = this.configService.get<string>('BALE_BOT_TOKEN');
    const tgToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    return {
      bale: `https://tapi.bale.ai/bot${baleToken}`,
      telegram: `https://api.telegram.org/bot${tgToken}`
    };
  }

  // اضافه کردن پارامتر اختیاری parseMode با مقدار پیش‌فرض 'HTML'
  async sendMessage(chatId: string, text: string, parseMode: string = 'HTML'): Promise<any> {
    const urls = this.getUrls();
    const tgChatId = this.configService.get<string>('TELEGRAM_CHANNEL_ID');

    // تبدیل تگ‌های <b> به <strong> برای سازگاری کامل با بله
    const processedText = parseMode === 'HTML' ? this.replaceBoldTags(text) : text;

    const promises: Promise<any>[] = [];

    // ارسال به بله
    if (this.configService.get('BALE_BOT_TOKEN')) {
        promises.push(
          firstValueFrom(this.httpService.post(`${urls.bale}/sendMessage`, {
            chat_id: chatId,
            text: processedText,
            parse_mode: parseMode,
          })).then(() => this.logger.log(`✅ Sent to Bale: ${chatId}`))
             .catch((err) => this.logger.error(`❌ Bale Error: ${err.message}`))
        );
    }

    // ارسال به تلگرام
    if (this.configService.get('TELEGRAM_BOT_TOKEN') && tgChatId) {
      promises.push(
        firstValueFrom(this.httpService.post(`${urls.telegram}/sendMessage`, {
          chat_id: tgChatId,
          text: processedText,
          parse_mode: parseMode,
        })).then(() => this.logger.log(`✅ Sent to Telegram: ${tgChatId}`))
           .catch((err) => this.logger.error(`❌ Telegram Error: ${err.message}`))
      );
    }

    return Promise.allSettled(promises);
  }

  // اضافه کردن پارامتر اختیاری parseMode به ارسال عکس با مقدار پیش‌فرض 'HTML'
  async sendPhotoBuffer(
    chatId: string,
    buffer: Buffer,
    caption: string,
    parseMode: string = 'HTML'
  ): Promise<any> {
    const urls = this.getUrls();
    const tgChatId = this.configService.get<string>('TELEGRAM_CHANNEL_ID');
    
    const results: Promise<any>[] = [];

    // ارسال به بله
    if (this.configService.get('BALE_BOT_TOKEN')) {
        results.push(this.executeSendPhoto(urls.bale, chatId, buffer, caption, 'Bale', parseMode));
    }

    // ارسال به تلگرام
    if (this.configService.get('TELEGRAM_BOT_TOKEN') && tgChatId) {
        results.push(this.executeSendPhoto(urls.telegram, tgChatId, buffer, caption, 'Telegram', parseMode));
    }

    return Promise.allSettled(results);
  }

  private async executeSendPhoto(
    baseUrl: string, 
    targetId: string, 
    buffer: Buffer, 
    caption: string, 
    platformName: string,
    parseMode: string = 'HTML'
  ): Promise<void> {
    try {
      const stream = new Readable();
      stream.push(buffer);
      stream.push(null);

      // تبدیل تگ‌های <b> به <strong> برای سازگاری کامل با بله
      const processedCaption = parseMode === 'HTML' ? this.replaceBoldTags(caption) : caption;

      const formData = new FormData();
      formData.append('chat_id', targetId);
      formData.append('photo', stream, {
        filename: 'chart.png',
        contentType: 'image/png',
        knownLength: buffer.length
      });
      formData.append('caption', processedCaption);
      formData.append('parse_mode', parseMode);

      await firstValueFrom(
        this.httpService.post(`${baseUrl}/sendPhoto`, formData, {
          timeout: this.PHOTO_TIMEOUT,
          headers: { ...formData.getHeaders() },
        }),
      );
      this.logger.log(`✅ Photo sent successfully to ${platformName}`);
    } catch (error: any) {
      this.logger.error(`❌ Failed to send photo to ${platformName}: ${error?.message}`);
    }
  }

  // متد کمکی برای تبدیل تگ‌های Bold به strong سازگار با بله
  private replaceBoldTags(text: string): string {
    if (!text) return '';
    return text.replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>');
  }
}
