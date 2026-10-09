import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Role } from './role.entity';
import { Order } from '../../orders/entities/order.entity';
import { Quote } from '../../quotes/entities/quote.entity';
import { Inquiry } from '../../inquiries/entities/inquiry.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'role_id', type: 'int', unsigned: true })
  roleId: number;

  // Nullable for casual staff who don't have email accounts.
  // Uniqueness is enforced in UsersService only when a value is provided.
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  // PIN is the primary login for casuals — required and unique.
  @Index({ unique: true })
  @Column({ name: 'pin_code', type: 'varchar', length: 6 })
  pinCode: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  // Set when an admin deletes a user who has sales history: they can't
  // log in, drop off the Users page, and their PIN / email are freed,
  // while past orders and reports keep their name. A plain column, not
  // @DeleteDateColumn, so order/report joins still find the row.
  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Role, (role) => role.users)
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @OneToMany(() => Order, (order) => order.user)
  orders: Order[];

  @OneToMany(() => Quote, (quote) => quote.user)
  quotes: Quote[];

  @OneToMany(() => Inquiry, (inquiry) => inquiry.user)
  inquiries: Inquiry[];

  // Virtual property
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }
}
