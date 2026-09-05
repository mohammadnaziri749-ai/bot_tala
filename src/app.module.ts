import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { BaleService } from './bale/bale.service';
import { PriceService } from './price/price.service';
import { BotService } from './bot/bot.service';
import { PosterService } from './poster/poster.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule,
    ScheduleModule.forRoot(),
  ],
  providers: [BaleService, PriceService, BotService, PosterService],
})
export class AppModule {}
