import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { RefundsService } from './refunds.service';
import { Order, OrderItem, Refund, RefundItem, OrderEvent } from './entities';
import { Customer } from '../customers/entities/customer.entity';
import { ProductsModule } from '../products/products.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { CustomersModule } from '../customers/customers.module';
import { SyncModule } from '../sync/sync.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Refund, RefundItem, OrderEvent, Customer]),
    ProductsModule,
    DiscountsModule,
    CustomersModule,
    SyncModule,
    SettingsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, RefundsService],
  exports: [OrdersService, RefundsService],
})
export class OrdersModule {}
