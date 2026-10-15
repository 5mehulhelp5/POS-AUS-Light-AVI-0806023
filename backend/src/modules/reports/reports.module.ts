import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { DayClose } from './entities/day-close.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DayClose, PurchaseOrder])],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
