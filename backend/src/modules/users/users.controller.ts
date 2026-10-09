import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, RoleNames } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('role') role?: string,
    @Query('active') active?: boolean,
  ) {
    const { users, total } = await this.usersService.findAll({
      page,
      limit,
      role,
      active,
    });

    return {
      success: true,
      data: {
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          pinCode: user.pinCode,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          role: {
            id: user.role.id,
            name: user.role.name,
            displayName: user.role.displayName,
            maxDiscountPercent: user.role.maxDiscountPercent,
          },
          createdAt: user.createdAt,
        })),
        pagination: {
          page: page || 1,
          limit: limit || 20,
          total,
          totalPages: Math.ceil(total / (limit || 20)),
        },
      },
    };
  }

  @Get('roles')
  @ApiOperation({ summary: 'Get all available roles' })
  async getRoles() {
    const roles = await this.usersService.findAllRoles();
    return {
      success: true,
      data: { roles },
    };
  }

  @Get(':id')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersService.findById(id);
    if (!user) {
      return { success: false, error: { message: 'User not found' } };
    }

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
          role: {
            id: user.role.id,
            name: user.role.name,
            displayName: user.role.displayName,
            maxDiscountPercent: user.role.maxDiscountPercent,
            canStackDiscounts: user.role.canStackDiscounts,
          },
          createdAt: user.createdAt,
        },
      },
    };
  }

  @Post()
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Create new user' })
  async create(@Body() createUserDto: CreateUserDto) {
    const user = await this.usersService.create(createUserDto);
    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: {
            id: user.role.id,
            name: user.role.name,
            displayName: user.role.displayName,
          },
        },
      },
    };
  }

  @Put(':id')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Update user' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() current: any,
  ) {
    const user = await this.usersService.update(id, updateUserDto, current?.id);
    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
          role: {
            id: user.role.id,
            name: user.role.name,
            displayName: user.role.displayName,
          },
        },
      },
    };
  }

  // Permanent delete (Sally, 8 Oct 2026). Deactivating — the old meaning
  // of this route — is now the Active switch on the edit form (PUT).
  @Delete(':id')
  @Roles(RoleNames.ADMIN)
  @ApiOperation({ summary: 'Delete user permanently' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() current: any,
  ) {
    const { mode } = await this.usersService.remove(id, current?.id);
    return {
      success: true,
      data: { mode },
      message:
        mode === 'deleted'
          ? 'User deleted'
          : 'User removed — their past sales keep their name',
    };
  }
}
