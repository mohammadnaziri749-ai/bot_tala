import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

import { PriceService } from '../price/price.service';
import { BaleService } from '../bale/bale.service';
import { PosterService } from '../poster/poster.service';

@Injectable()
export class BotService {
  private static readonly TIME_ZONE = 'Asia/Tehran';

  private readonly logger = new Logger(BotService.name);

  /**
   * آخرین قیمت ثبت‌شده برای محاسبه روند قیمت
   *
   * توجه:
   * این Map فقط در حافظه نگهداری می‌شود و با restart شدن برنامه پاک خواهد شد.
   */
  private readonly lastPrices: Map<string, number> = new Map();

  private readonly CHANNEL_ID: string;

  constructor(
    private readonly priceService: PriceService,
    private readonly baleService: BaleService,
    private readonly configService: ConfigService,
    private readonly posterService: PosterService,
  ) {
    this.CHANNEL_ID = this.configService.get<string>('BALE_CHANNEL_ID') || '';

    if (!this.CHANNEL_ID) {
      this.logger.error('BALE_CHANNEL_ID is not configured.');
    }
  }

  // =========================================================
  // POSTER
  // =========================================================
  /**
   * ارسال Poster فقط در ساعت‌های:
   *
   * 12:00
   * 16:00
   * 19:00
   *
   * در این ساعت‌ها پیام قیمت معمولی ارسال نخواهد شد.
   */
  @Cron('0 0 12,16,19 * * *', {
    timeZone: BotService.TIME_ZONE,
  })
  async sendPricePoster(): Promise<void> {
    if (!this.CHANNEL_ID) {
      this.logger.warn(
        'CHANNEL_ID is not configured, skipping poster cron job.',
      );
      return;
    }

    try {
      this.logger.log('🖼️ Generating and sending price poster...');

      const data = await this.priceService.getPrices();

      if (!data) {
        throw new Error('API returned no data for poster');
      }

      const posterText = await this.posterService.generatePricePoster(data);

      if (!posterText) {
        throw new Error('Poster service returned empty content');
      }

      const footer =
        '\n\n━━━━━━━━━━━━━━━━\n' +
        '📎 خرید و فروش طلا و ارز با نرخ روز\n' +
        '👔 ثبت سفارش: @atabak_admin\n' +
        '📱 شماره تماس: 09123510031\n' +
        '━━━━━━━━━━━━━━━━\n' +
        '🆔 @tala_atabak';

      await this.baleService.sendMessage(
        this.CHANNEL_ID,
        `${posterText}${footer}`,
        'HTML',
      );

      /**
       * بعد از ارسال موفق Poster،
       * قیمت‌های فعلی را به عنوان آخرین قیمت ثبت می‌کنیم.
       *
       * بنابراین مثلاً در 12:30، روند قیمت نسبت به 12:00
       * محاسبه خواهد شد.
       */
      this.updateLastPrices(data);

      this.logger.log('✅ Price poster sent successfully.');
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to send price poster: ${error?.message}`,
        error?.stack,
      );
    }
  }

  // =========================================================
  // REGULAR PRICE MESSAGE
  // =========================================================
  /**
   * ارسال پیام قیمت معمولی:
   *
   * از 08:00 تا 21:30
   * هر نیم ساعت
   *
   * به جز:
   *
   * 12:00  -> Poster
   * 16:00  -> Poster
   * 19:00  -> Poster
   *
   * بنابراین در ساعت‌های Poster، پیام عادی ارسال نمی‌شود.
   */
  @Cron('0 0,30 8-21 * * *', {
    timeZone: BotService.TIME_ZONE,
  })
  async handleRegularCron(): Promise<void> {
    if (!this.CHANNEL_ID) {
      this.logger.warn(
        'CHANNEL_ID is not configured, skipping regular price cron job.',
      );
      return;
    }

    try {
      /**
       * این Cron در ساعت‌های 12:00، 16:00 و 19:00 نیز
       * اجرا می‌شود، اما در این سه زمان باید فقط Poster ارسال شود.
       *
       * پس اینجا از ارسال پیام عادی جلوگیری می‌کنیم.
       */
      const iranTime = this.getIranTime();

      const isPosterTime =
        iranTime.minute === 0 && [12, 16, 19].includes(iranTime.hour);

      if (isPosterTime) {
        this.logger.log(
          `🖼️ ${iranTime.time} is poster time. Skipping regular price message.`,
        );
        return;
      }

      await this.sendRegularPriceMessage(iranTime.date, iranTime.time);
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to send regular market update: ${error?.message}`,
        error?.stack,
      );
    }
  }

  // =========================================================
  // 22:00 FINAL MESSAGE
  // =========================================================
  /**
   * آخرین پیام قیمت روز در ساعت 22:00 به وقت ایران.
   */
  @Cron('0 0 22 * * *', {
    timeZone: BotService.TIME_ZONE,
  })
  async handleFinalCron(): Promise<void> {
    if (!this.CHANNEL_ID) {
      this.logger.warn(
        'CHANNEL_ID is not configured, skipping final price cron job.',
      );
      return;
    }

    try {
      const iranTime = this.getIranTime();

      this.logger.log(
        `🌙 Sending final daily price update at ${iranTime.time}...`,
      );

      await this.sendRegularPriceMessage(iranTime.date, iranTime.time);
    } catch (error: any) {
      this.logger.error(
        `❌ Failed to send final daily market update: ${error?.message}`,
        error?.stack,
      );
    }
  }

  // =========================================================
  // SEND REGULAR PRICE MESSAGE
  // =========================================================
  private async sendRegularPriceMessage(
    currentDate: string,
    currentTime: string,
  ): Promise<void> {
    this.logger.log(`⏳ Starting price update process at ${currentTime}...`);

    const data = await this.priceService.getPrices();

    if (!data) {
      throw new Error('API returned no data');
    }

    const message = this.formatMessage(data, currentDate, currentTime);

    this.logger.log(
      `📩 Sending price message to Bale channel at ${currentTime}...`,
    );

    await this.baleService.sendMessage(this.CHANNEL_ID, message, 'HTML');

    this.logger.log('✅ Market update sent successfully.');
  }

  // =========================================================
  // IRAN TIME
  // =========================================================
  /**
   * دریافت تاریخ و ساعت فعلی بر اساس تهران.
   *
   * مستقل از Timezone سرور.
   */
  private getIranTime(): {
    hour: number;
    minute: number;
    time: string;
    date: string;
  } {
    const now = new Date();

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BotService.TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const hourPart = parts.find((part) => part.type === 'hour');

    const minutePart = parts.find((part) => part.type === 'minute');

    let hour = Number(hourPart?.value ?? 0);

    const minute = Number(minutePart?.value ?? 0);

    /**
     * بعضی runtimeها ممکن است midnight را به صورت 24 نمایش دهند.
     * برای جلوگیری از مشکل، 24 را به 0 تبدیل می‌کنیم.
     */
    if (hour === 24) {
      hour = 0;
    }

    const currentTime = now.toLocaleTimeString('fa-IR', {
      timeZone: BotService.TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const currentDate = now.toLocaleDateString('fa-IR', {
      timeZone: BotService.TIME_ZONE,
    });

    return {
      hour,
      minute,
      time: currentTime,
      date: currentDate,
    };
  }

  // =========================================================
  // UPDATE LAST PRICES
  // =========================================================
  /**
   * ذخیره آخرین قیمت‌های دریافت‌شده.
   *
   * برای محاسبه 🔺 / 🔻 / 🔹 استفاده می‌شود.
   */
  private updateLastPrices(data: any): void {
    const gold = data?.gold || [];
    const currency = data?.currency || [];

    const allItems = [...gold, ...currency];

    for (const item of allItems) {
      if (
        !item ||
        !item.symbol ||
        item.price === undefined ||
        item.price === null
      ) {
        continue;
      }

      const currentPrice = Number(item.price);

      if (Number.isNaN(currentPrice)) {
        continue;
      }

      this.lastPrices.set(String(item.symbol), currentPrice);
    }
  }

  // =========================================================
  // HTML ESCAPE
  // =========================================================
  private escapeHtml(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // =========================================================
  // FORMAT MESSAGE
  // =========================================================
  private formatMessage(
    data: any,
    currentDate: string,
    currentTime: string,
  ): string {
    const gold = data?.gold || [];
    const currency = data?.currency || [];

    const formatPrice = (value: any): string => {
      const number = Number(value);

      return Number.isNaN(number) ? '---' : number.toLocaleString('fa-IR');
    };

    const getTrendEmoji = (symbol: string, currentPrice: number): string => {
      /**
       * اگر symbol معتبر نباشد،
       * نمی‌توانیم روند قیمت را به صورت صحیح محاسبه کنیم.
       */
      if (!symbol) {
        return '◽';
      }

      const lastPrice = this.lastPrices.get(symbol);

      /**
       * قیمت فعلی را برای دفعات بعد ذخیره می‌کنیم.
       */
      this.lastPrices.set(symbol, currentPrice);

      if (lastPrice === undefined) {
        return '◽';
      }

      if (currentPrice > lastPrice) {
        return '🔺';
      }

      if (currentPrice < lastPrice) {
        return '🔻';
      }

      return '🔹';
    };

    const formatLine = (item: any, label?: string): string | null => {
      if (!item || item.price === undefined || item.price === null) {
        return null;
      }

      const currentPrice = Number(item.price);

      /**
       * اگر قیمت عدد معتبر نباشد،
       * روند قیمت را محاسبه نمی‌کنیم.
       */
      const trendEmoji = Number.isNaN(currentPrice)
        ? '◽'
        : getTrendEmoji(String(item.symbol || ''), currentPrice);

      const name = this.escapeHtml(label || item.name || item.symbol || '');

      const price = this.escapeHtml(formatPrice(item.price));

      const unit = this.escapeHtml(item.unit || '');

      const changePercent =
        item.change_percent !== undefined && item.change_percent !== null
          ? ` (${this.escapeHtml(item.change_percent)}%)`
          : '';

      return (
        `${name}: <b>${price}</b> ${unit} ` + `${trendEmoji}${changePercent}`
      );
    };

    const lines: string[] = [
      '📌 <b>گزارش لحظه‌ای بازار</b>',
      `🕒 ${this.escapeHtml(currentDate)} | ${this.escapeHtml(currentTime)}`,
      '━━━━━━━━━━━━━━━━',
      '🟨 <b>طلا</b>',
    ];

    // =======================================================
    // GOLD
    // =======================================================

    const goldItems = [
      {
        symbol: 'XAUUSD',
        label: 'اونس جهانی',
      },
      {
        symbol: 'IR_GOLD_18K',
        label: 'طلای ۱۸ عیار',
      },
      {
        symbol: 'IR_GOLD_24K',
        label: 'طلای ۲۴ عیار',
      },
      {
        symbol: 'IR_GOLD_MELTED',
        label: 'آبشده نقدی',
      },
    ];

    goldItems.forEach((goldItem) => {
      const item = gold.find(
        (goldData: any) => goldData?.symbol === goldItem.symbol,
      );

      const line = formatLine(item, goldItem.label);

      if (line) {
        lines.push(line);
      }
    });

    // =======================================================
    // COINS
    // =======================================================

    lines.push('', '🪙 <b>سکه</b>');

    const coinItems = [
      {
        symbol: 'IR_COIN_EMAMI',
        label: 'سکه امامی',
      },
      {
        symbol: 'IR_COIN_BAHAR',
        label: 'سکه تمام بهار',
      },
      {
        symbol: 'IR_COIN_HALF',
        label: 'نیم سکه',
      },
      {
        symbol: 'IR_COIN_QUARTER',
        label: 'ربع سکه',
      },
      {
        symbol: 'IR_COIN_1G',
        label: 'سکه گرمی',
      },
    ];

    coinItems.forEach((coinItem) => {
      const item = gold.find(
        (goldData: any) => goldData?.symbol === coinItem.symbol,
      );

      const line = formatLine(item, coinItem.label);

      if (line) {
        lines.push(line);
      }
    });

    // =======================================================
    // CURRENCY
    // =======================================================

    lines.push('', '💰 <b>ارز (تومان)</b>');

    const currencyItems = [
      {
        symbol: 'USDT_IRT',
        label: 'تتر (فی)',
      },
      {
        symbol: 'USD',
        label: '🇺🇸 دلار آمریکا',
      },
      {
        symbol: 'EUR',
        label: '🇪🇺 یورو',
      },
      {
        symbol: 'GBP',
        label: '🇬🇧 پوند',
      },
      {
        symbol: 'TRY',
        label: '🇹🇷 لیر ترکیه',
      },
      {
        symbol: 'AED',
        label: '🇦🇪 درهم امارات',
      },
      {
        symbol: 'CNY',
        label: '🇨🇳 یوآن چین',
      },
    ];

    currencyItems.forEach((currencyItem) => {
      const item = currency.find(
        (currencyData: any) => currencyData?.symbol === currencyItem.symbol,
      );

      const line = formatLine(item, currencyItem.label);

      if (line) {
        lines.push(line);
      }
    });

    // =======================================================
    // FOOTER
    // =======================================================

    lines.push(
      '',
      '━━━━━━━━━━━━━━━━',
      '📎 خرید و فروش طلا و ارز با نرخ روز',
      '👔 ثبت سفارش: @atabak_admin',
      '📱 شماره تماس: 09123510031',
      '━━━━━━━━━━━━━━━━',
      '🆔 @tala_atabak',
    );

    return lines.join('\n');
  }
}
