import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getPrices(): Promise<any> {
    const url = this.configService.get<string>('PRICE_API_URL');

    if (!url) {
      this.logger.error('PRICE_API_URL is not defined');
      throw new InternalServerErrorException('API URL configuration is missing');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 60000,
          headers: { 
            'Accept': 'application/json',
            // استفاده از یک یوزر ایجنت کامل و واقعی مرورگر کروم
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
        }),
      );

      return response.data;
    } catch (error: any) {
      if (error.response) {
        this.logger.error(`❌ API Error | Status: ${error.response.status} | Data: ${JSON.stringify(error.response.data)}`);
      } else {
        this.logger.error(`❌ Connection Error: ${error.message}`);
      }
      throw new Error('Could not fetch market data from API');
    }
  }
}
