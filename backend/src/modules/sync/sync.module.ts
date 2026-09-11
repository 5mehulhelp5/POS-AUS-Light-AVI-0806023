import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SyncLog, SyncQueue } from './entities';
import { Product } from '../products/entities/product.entity';
import { Category } from '../products/entities/category.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { MagentoService } from './magento.service';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    ConfigModule,
    SettingsModule,
    TypeOrmModule.forFeature([SyncLog, SyncQueue, Product, Category, Customer, Order, OrderItem]),
  ],
  controllers: [SyncController],
  providers: [MagentoService, SyncService],
  exports: [MagentoService, SyncService],
})
export class SyncModule {}
