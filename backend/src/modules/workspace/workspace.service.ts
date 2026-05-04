import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantRepository } from '../../common/repositories/tenant.repository';
import { Client } from '../clients/client.entity';
import { User } from '../users/user.entity';

export interface WorkspaceContext {
  client: {
    id: string;
    nombre: string;
    plan: string;
    status: string;
  };
  user: {
    id: string;
    email: string;
    role: string;
    full_name: string | null;
  };
  modules: Record<string, boolean>;
  navigation: Array<{ key: string; label: string; icon: string; path: string }>;
}

export interface MasterDataStatus {
  client_id: string;
  tables: Array<{ table: string; has_records: boolean; count: number }>;
}

@Injectable()
export class WorkspaceService {
  private readonly userRepo: TenantRepository<User>;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    // FIXED: (dataSource, entity) order.
    // Note: Client entity does NOT extend TenantBaseEntity (it IS the tenant root),
    // so we can't wrap it in TenantRepository. We use dataSource.getRepository directly.
    this.userRepo = new TenantRepository<User>(dataSource, User);
  }

  async context(clientId: string, userId: string, role: string): Promise<WorkspaceContext> {
    const client = await this.dataSource.getRepository(Client).findOne({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Client not found');

    // FIXED: findOne(clientId, id) takes id directly and throws NotFoundException itself
    const user = await this.userRepo.findOne(clientId, userId);

    const plan = (client as unknown as { plan?: string }).plan ?? 'basic';
    const modules = this.buildModules(role, plan);
    const navigation = this.buildNavigation(role, plan);

    return {
      client: {
        id: client.id,
        nombre: (client as unknown as { nombre: string }).nombre,
        plan,
        status: (client as unknown as { status: string }).status,
      },
      user: {
        id: user.id,
        email: (user as unknown as { email: string }).email,
        role,
        full_name: (user as unknown as { full_name?: string | null }).full_name ?? null,
      },
      modules,
      navigation,
    };
  }

  private buildModules(role: string, plan: string): Record<string, boolean> {
    const isSuper = role === 'super_admin';
    const proOrEnterprise = plan === 'pro' || plan === 'enterprise';
    return {
      projects: true,
      campaigns: true,
      activations: true,
      promoters: true,
      locations: true,
      documents: true,
      dashboard: true,
      collaborators: proOrEnterprise,
      onboarding: isSuper,
    };
  }

  private buildNavigation(
    role: string,
    plan: string,
  ): Array<{ key: string; label: string; icon: string; path: string }> {
    const base = [
      { key: 'dashboard', label: 'Dashboard', icon: 'chart-bar', path: '/dashboard' },
    ];

    if (role === 'user') {
      return [
        ...base,
        { key: 'projects', label: 'Projects', icon: 'folder', path: '/projects' },
        { key: 'activations', label: 'Activations', icon: 'calendar', path: '/activations' },
      ];
    }

    const adminNav = [
      ...base,
      { key: 'projects', label: 'Projects', icon: 'folder', path: '/projects' },
      { key: 'campaigns', label: 'Campaigns', icon: 'megaphone', path: '/campaigns' },
      { key: 'activations', label: 'Activations', icon: 'calendar', path: '/activations' },
      { key: 'promoters', label: 'Promoters', icon: 'users', path: '/promoters' },
      { key: 'locations', label: 'Locations', icon: 'map-pin', path: '/locations' },
      { key: 'documents', label: 'Documents', icon: 'file-up', path: '/documents' },
    ];

    if (plan === 'pro' || plan === 'enterprise') {
      adminNav.push({
        key: 'collaborators',
        label: 'Collaborators',
        icon: 'user-plus',
        path: '/collaborators',
      });
    }

    if (role === 'super_admin') {
      adminNav.push({
        key: 'onboarding',
        label: 'Onboarding',
        icon: 'settings',
        path: '/onboarding',
      });
    }

    return adminNav;
  }

  async masterDataStatus(clientId: string): Promise<MasterDataStatus> {
    const results = await this.dataSource.query(
      `
      SELECT 'projects' AS table, COUNT(*)::int AS count FROM projects WHERE client_id = $1
      UNION ALL
      SELECT 'locations',  COUNT(*)::int FROM locations  WHERE client_id = $1
      UNION ALL
      SELECT 'promoters',  COUNT(*)::int FROM promoters  WHERE client_id = $1
      UNION ALL
      SELECT 'campaigns',  COUNT(*)::int FROM campaigns  WHERE client_id = $1
      UNION ALL
      SELECT 'activations', COUNT(*)::int FROM activations WHERE client_id = $1
      UNION ALL
      SELECT 'collaborators', COUNT(*)::int FROM collaborators WHERE client_id = $1
      `,
      [clientId],
    );

    return {
      client_id: clientId,
      tables: results.map((r: { table: string; count: number }) => ({
        table: r.table,
        has_records: Number(r.count) > 0,
        count: Number(r.count),
      })),
    };
  }
}