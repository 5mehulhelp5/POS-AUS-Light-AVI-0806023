import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// End-of-day close (Z report). Closing snapshots the totals since the
// previous close and starts a fresh window — "it closes the day and
// resets" (Sally, Oct 2026). The snapshot is kept so a past day can be
// reprinted exactly as it was closed.
@Entity('day_closes')
export class DayClose {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  // Window covered: previous close (or start of that day) -> this close.
  @Column({ name: 'opened_at', type: 'datetime', precision: 6 })
  openedAt: Date;

  @Index()
  @Column({ name: 'closed_at', type: 'datetime', precision: 6 })
  closedAt: Date;

  @Column({ name: 'closed_by', type: 'int', unsigned: true, nullable: true })
  closedBy: number | null;

  @Column({ name: 'closed_by_name', type: 'varchar', length: 200, nullable: true })
  closedByName: string | null;

  @Column({ type: 'json' })
  totals: Record<string, unknown>;

  @Column({ name: 'cash_counted', type: 'decimal', precision: 12, scale: 2, nullable: true })
  cashCounted: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
