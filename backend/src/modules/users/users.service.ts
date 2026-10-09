import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, Role } from './entities';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  async findAll(options?: {
    page?: number;
    limit?: number;
    role?: string;
    active?: boolean;
  }): Promise<{ users: User[]; total: number }> {
    const { role, active } = options || {};
    const page = Number(options?.page) || 1;
    const limit = Number(options?.limit) || 20;

    const query = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.deletedAt IS NULL');

    if (role) {
      query.andWhere('role.name = :role', { role });
    }

    if (active !== undefined) {
      query.andWhere('user.isActive = :active', { active });
    }

    const [users, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('user.createdAt', 'DESC')
      .getManyAndCount();

    return { users, total };
  }

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['role'],
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    // Skip lookup for blank emails — casuals without an email should never match.
    if (!email) return null;
    return this.userRepository.findOne({
      where: { email, isActive: true },
      relations: ['role'],
    });
  }

  /**
   * Check whether an email is already taken by a DIFFERENT active user.
   * Null/empty emails are always allowed (casuals without email).
   */
  private async isEmailTaken(
    email: string | null | undefined,
    excludeUserId?: number,
  ): Promise<boolean> {
    if (!email) return false;
    const query = this.userRepository
      .createQueryBuilder('user')
      .where('user.email = :email', { email });
    if (excludeUserId) {
      query.andWhere('user.id != :id', { id: excludeUserId });
    }
    const existing = await query.getOne();
    return !!existing;
  }

  /**
   * Check whether a PIN is already taken by a DIFFERENT user.
   * PINs must be globally unique because they're the login identifier.
   */
  private async isPinTaken(
    pinCode: string,
    excludeUserId?: number,
  ): Promise<boolean> {
    const query = this.userRepository
      .createQueryBuilder('user')
      .where('user.pinCode = :pinCode', { pinCode });
    if (excludeUserId) {
      query.andWhere('user.id != :id', { id: excludeUserId });
    }
    const existing = await query.getOne();
    return !!existing;
  }

  async findByPinCode(pinCode: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { pinCode, isActive: true },
      relations: ['role'],
    });
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const { email, password, roleId, pinCode, ...rest } = createUserDto;

    // PIN is required for all users — it's the primary login for casuals
    // and also how sales are attributed in reports.
    if (!pinCode || !pinCode.trim()) {
      throw new BadRequestException('PIN code is required');
    }

    // Email is optional. When provided, it must be unique.
    const normalisedEmail = email && email.trim() ? email.trim() : null;
    if (await this.isEmailTaken(normalisedEmail)) {
      throw new ConflictException('Email already exists');
    }

    // PIN must be globally unique
    if (await this.isPinTaken(pinCode)) {
      throw new ConflictException('PIN code already in use');
    }

    // Verify role exists
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Password is optional too — casuals may only use PIN login.
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;

    const user = this.userRepository.create({
      ...rest,
      email: normalisedEmail,
      passwordHash,
      roleId,
      pinCode,
    } as Partial<User>);

    const savedUser = await this.userRepository.save(user);
    return this.findById(savedUser.id) as Promise<User>;
  }

  async update(
    id: number,
    updateUserDto: UpdateUserDto,
    actingUserId?: number,
  ): Promise<User> {
    const user = await this.findById(id);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }

    const { password, roleId, pinCode, email, ...rest } = updateUserDto;

    // An admin can't lock themselves out by demoting or deactivating
    // their own account, and the store always keeps one active admin.
    const losesAdmin =
      user.role?.name === 'admin' &&
      ((roleId && roleId !== user.roleId) || rest.isActive === false);
    if (losesAdmin) {
      if (actingUserId === id) {
        throw new BadRequestException(
          "You can't remove your own admin access — ask another admin",
        );
      }
      await this.assertAnotherAdmin(id);
    }

    // Email: allow clearing it (empty string → null) for casuals.
    let normalisedEmail: string | null | undefined;
    if (email !== undefined) {
      normalisedEmail = email && email.trim() ? email.trim() : null;
      if (normalisedEmail !== user.email) {
        if (await this.isEmailTaken(normalisedEmail, id)) {
          throw new ConflictException('Email already exists');
        }
      }
    }

    // PIN: cannot be cleared (still required) and must stay unique.
    if (pinCode !== undefined) {
      if (!pinCode || !pinCode.trim()) {
        throw new BadRequestException('PIN code is required');
      }
      if (pinCode !== user.pinCode && (await this.isPinTaken(pinCode, id))) {
        throw new ConflictException('PIN code already in use');
      }
    }

    // Verify role if changing
    if (roleId && roleId !== user.roleId) {
      const role = await this.roleRepository.findOne({ where: { id: roleId } });
      if (!role) {
        throw new NotFoundException('Role not found');
      }
    }

    // Build update payload
    const updateData: Partial<User> = {
      ...rest,
    };

    if (email !== undefined) updateData.email = normalisedEmail ?? null;
    if (pinCode !== undefined) updateData.pinCode = pinCode;
    if (roleId) updateData.roleId = roleId;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    await this.userRepository.update(id, updateData);
    return this.findById(id) as Promise<User>;
  }

  async deactivate(id: number): Promise<void> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(id, { isActive: false });
  }

  private async assertAnotherAdmin(excludeUserId: number): Promise<void> {
    const others = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.role', 'role')
      .where('role.name = :admin', { admin: 'admin' })
      .andWhere('user.isActive = 1')
      .andWhere('user.deletedAt IS NULL')
      .andWhere('user.id != :id', { id: excludeUserId })
      .getCount();
    if (others === 0) {
      throw new BadRequestException(
        'This is the only active admin — make someone else an admin first',
      );
    }
  }

  /**
   * Admin "Delete user" (Sally, 8 Oct 2026). A user with no history is
   * deleted outright. One who has rung up sales, quotes, refunds etc.
   * can't be — those records point at them — so they're removed from
   * the system instead: login disabled, PIN and email freed for reuse,
   * hidden from the Users page; past orders and reports keep the name.
   */
  async remove(
    id: number,
    actingUserId: number,
  ): Promise<{ mode: 'deleted' | 'removed' }> {
    const user = await this.findById(id);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }
    if (id === actingUserId) {
      throw new BadRequestException("You can't delete your own account");
    }
    if (user.role?.name === 'admin') {
      await this.assertAnotherAdmin(id);
    }
    try {
      await this.userRepository.delete(id);
      return { mode: 'deleted' };
    } catch (err: any) {
      // ER_ROW_IS_REFERENCED_2 — something (orders, logins, refunds…)
      // still points at this user.
      if (err?.errno !== 1451 && err?.code !== 'ER_ROW_IS_REFERENCED_2') {
        throw err;
      }
    }
    await this.userRepository.update(id, {
      isActive: false,
      deletedAt: new Date(),
      email: null,
      passwordHash: null,
      // pin_code is NOT NULL + unique: a non-numeric placeholder frees
      // the real PIN and can never be typed on the PIN pad.
      pinCode: `x${id}`.slice(0, 6),
    });
    return { mode: 'removed' };
  }

  async updateLastLogin(id: number): Promise<void> {
    await this.userRepository.update(id, {
      lastLoginAt: new Date(),
    });
  }

  async findAllRoles(): Promise<Role[]> {
    return this.roleRepository.find({
      order: { id: 'ASC' },
    });
  }
}
