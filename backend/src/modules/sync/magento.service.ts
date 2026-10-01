import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface MagentoProduct {
  id: number;
  sku: string;
  name: string;
  type_id: string;
  status: number; // 1=enabled, 2=disabled
  visibility: number; // 1=not visible, 2=catalog, 3=search, 4=catalog+search
  price: number;
  weight?: number;
  created_at?: string;
  updated_at?: string;
  // Custom attributes from REST API (flat key-value after parsing)
  custom_attributes?: Array<{
    attribute_code: string;
    value: any;
  }>;
  // Media gallery from REST API
  media_gallery_entries?: Array<{
    id: number;
    media_type: string;
    label: string | null;
    position: number;
    disabled: boolean;
    types: string[];
    file: string;
  }>;
  // Category links from extension_attributes
  extension_attributes?: {
    category_links?: Array<{
      category_id: string;
      position: number;
    }>;
    // Stock quantity (simple number from this Magento instance)
    stock_quantity?: number;
    // Some Magento versions return stock_item object instead
    stock_item?: {
      qty: number;
      is_in_stock: boolean;
    };
  };
}

export interface MagentoCategory {
  id: number;
  name: string;
  parent_id: number;
  level: number;
  path: string;
  is_active: boolean;
  position: number;
  children?: MagentoCategory[];
}

export interface MagentoProductsResponse {
  items: MagentoProduct[];
  total_count: number;
  search_criteria: {
    page_size: number;
    current_page: number;
  };
}

export interface MagentoCustomerAddress {
  id: number;
  customer_id: number;
  region?: {
    region_code: string;
    region: string;
    region_id: number;
  };
  country_id: string;
  street: string[];
  telephone?: string;
  postcode?: string;
  city?: string;
  firstname?: string;
  lastname?: string;
  default_shipping?: boolean;
  default_billing?: boolean;
  company?: string;
}

export interface MagentoCustomer {
  id: number;
  email: string;
  firstname: string;
  lastname: string;
  group_id: number;
  store_id: number;
  created_at: string;
  updated_at: string;
  addresses?: MagentoCustomerAddress[];
  custom_attributes?: Array<{
    attribute_code: string;
    value: any;
  }>;
  extension_attributes?: {
    company_attributes?: {
      company_id: number;
    };
  };
}

export interface MagentoCustomersResponse {
  items: MagentoCustomer[];
  total_count: number;
  search_criteria: {
    page_size: number;
    current_page: number;
  };
}

export interface MagentoOrderItem {
  item_id: number;
  product_id: number;
  sku: string;
  name: string;
  qty_ordered: number;
  price: number;
  price_incl_tax?: number;
  row_total: number;
  row_total_incl_tax?: number;
  discount_amount?: number;
  tax_amount?: number;
}

export interface MagentoOrder {
  entity_id: number;
  increment_id: string;
  status: string;
  state: string;
  customer_id?: number | null;
  customer_email?: string;
  customer_firstname?: string;
  customer_lastname?: string;
  customer_is_guest?: number;
  subtotal: number;
  subtotal_incl_tax?: number;
  tax_amount: number;
  discount_amount: number;
  grand_total: number;
  total_paid?: number;
  created_at: string;
  updated_at: string;
  items: MagentoOrderItem[];
  billing_address?: {
    firstname?: string;
    lastname?: string;
    telephone?: string;
    email?: string;
    street?: string[];
    city?: string;
    postcode?: string;
    region?: string;
    country_id?: string;
  };
  payment?: {
    method: string;
  };
}

export interface MagentoOrdersResponse {
  items: MagentoOrder[];
  total_count: number;
}

@Injectable()
export class MagentoService {
  private readonly logger = new Logger(MagentoService.name);
  private readonly baseUrl: string;
  private readonly adminUsername: string;
  private readonly adminPassword: string;
  private readonly timeout: number;
  private adminToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private httpClient: AxiosInstance;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('MAGENTO_BASE_URL') || '';
    this.adminUsername = this.configService.get<string>('MAGENTO_ADMIN_USERNAME') || '';
    this.adminPassword = this.configService.get<string>('MAGENTO_ADMIN_PASSWORD') || '';
    this.timeout = this.configService.get<number>('MAGENTO_TIMEOUT') || 30000;

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getAdminToken(): Promise<string> {
    // Return cached token if still valid (tokens typically last 4 hours)
    if (this.adminToken && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.adminToken;
    }

    this.logger.log(
      `Fetching Magento admin token from ${this.baseUrl} as user "${this.adminUsername}"...`,
    );

    if (!this.baseUrl || !this.adminUsername || !this.adminPassword) {
      const missing: string[] = [];
      if (!this.baseUrl) missing.push('MAGENTO_BASE_URL');
      if (!this.adminUsername) missing.push('MAGENTO_ADMIN_USERNAME');
      if (!this.adminPassword) missing.push('MAGENTO_ADMIN_PASSWORD');
      const msg = `Magento auth env vars not set: ${missing.join(', ')}`;
      this.logger.error(msg);
      throw new Error(msg);
    }

    try {
      const response = await this.httpClient.post(
        '/rest/V1/integration/admin/token',
        {
          username: this.adminUsername,
          password: this.adminPassword,
        },
      );

      this.adminToken = response.data;
      // Set expiry to 3.5 hours from now (tokens last 4 hours)
      this.tokenExpiry = new Date(Date.now() + 3.5 * 60 * 60 * 1000);

      this.logger.log('Successfully obtained Magento admin token');
      return this.adminToken as string;
    } catch (error: any) {
      // Surface what Magento actually said. Status + payload usually
      // identifies the problem: 401 = bad creds, 400 with a "validation"
      // payload = 2FA / locked account, network errors = wrong base URL
      // or VPS IP blocked.
      const status = error?.response?.status;
      const data = error?.response?.data;
      const detail =
        typeof data === 'string'
          ? data
          : data?.message
            ? data.message
            : data?.errors
              ? JSON.stringify(data.errors)
              : error?.code || error?.message || 'unknown';
      this.logger.error(
        `Magento admin/token failed (status=${status ?? 'no response'}): ${detail}`,
      );
      throw new Error(
        `Failed to authenticate with Magento (status ${status ?? 'no response'}): ${detail}`,
      );
    }
  }

  // Fetch the option list for a Magento product attribute (e.g.
  // `manufacturer` or `brand`). Custom select-type attributes come back
  // on each product as numeric option ids — this endpoint lets us build
  // an id→label map so the sync can store the human name ("Havit") on
  // Product.brand instead of the meaningless id.
  async fetchAttributeOptions(
    attributeCode: string,
  ): Promise<Array<{ value: string; label: string }>> {
    const token = await this.getAdminToken();
    try {
      const response = await this.httpClient.get(
        `/rest/V1/products/attributes/${encodeURIComponent(attributeCode)}/options`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000,
        },
      );
      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      // 404 = attribute doesn't exist on this store. Not fatal — the
      // sync just skips brand translation for products that carry a raw
      // string value instead of an option id.
      if (error?.response?.status === 404) return [];
      this.logger.warn(
        `Failed to fetch options for attribute '${attributeCode}': ${error?.message || error}`,
      );
      return [];
    }
  }

  async fetchProducts(
    pageSize: number = 100,
    currentPage: number = 1,
  ): Promise<MagentoProductsResponse> {
    const token = await this.getAdminToken();

    try {
      // Use REST API with admin token to get ALL products (including disabled/not visible)
      const response = await this.httpClient.get(
        `/rest/V1/products?searchCriteria[pageSize]=${pageSize}&searchCriteria[currentPage]=${currentPage}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 60000, // 60s timeout for large pages
        },
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch products from Magento', error);
      throw error;
    }
  }

  async fetchAllProducts(): Promise<MagentoProduct[]> {
    const allProducts: MagentoProduct[] = [];
    let currentPage = 1;
    const pageSize = 100; // REST API can handle larger pages
    let totalCount = 0;

    this.logger.log('Starting to fetch all products from Magento via REST API...');

    do {
      const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : '?';
      this.logger.log(`Fetching page ${currentPage} of ${totalPages}...`);
      const response = await this.fetchProducts(pageSize, currentPage);

      allProducts.push(...response.items);
      totalCount = response.total_count;
      this.logger.log(`Got ${response.items.length} products (total so far: ${allProducts.length}/${totalCount})`);
      currentPage++;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    } while (allProducts.length < totalCount);

    this.logger.log(`Fetched ${allProducts.length} products from Magento`);
    return allProducts;
  }

  async fetchCategories(): Promise<MagentoCategory[]> {
    const token = await this.getAdminToken();

    try {
      // Use REST API which returns the full category tree at any depth
      const response = await this.httpClient.get(
        '/rest/V1/categories',
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      // Flatten the category tree recursively (unlimited depth)
      const categories: MagentoCategory[] = [];
      const flattenCategories = (node: any) => {
        // Skip root category (level 0) and default category (level 1)
        if (node.level >= 2) {
          categories.push({
            id: node.id,
            name: node.name,
            parent_id: node.parent_id,
            level: node.level,
            path: node.path || '',
            is_active: node.is_active && node.include_in_menu,
            position: node.position ?? 0,
          });
        }

        if (node.children_data && node.children_data.length > 0) {
          for (const child of node.children_data) {
            flattenCategories(child);
          }
        }
      };

      flattenCategories(response.data);

      this.logger.log(`Fetched ${categories.length} categories from Magento (REST API, unlimited depth)`);
      return categories;
    } catch (error) {
      this.logger.error('Failed to fetch categories from Magento', error);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; productCount?: number }> {
    try {
      const response = await this.fetchProducts(1, 1);
      return {
        success: true,
        message: 'Successfully connected to Magento',
        productCount: response.total_count,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Fetch stock quantities for a single SKU
  async fetchStockBySku(sku: string): Promise<number> {
    const token = await this.getAdminToken();

    try {
      const response = await this.httpClient.get(
        `/rest/V1/stockItems/${encodeURIComponent(sku)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data?.qty || 0;
    } catch (error) {
      // Product might not have stock info
      return 0;
    }
  }

  // Fetch stock quantities for multiple SKUs in batches
  async fetchStockForSkus(skus: string[]): Promise<Map<string, number>> {
    const token = await this.getAdminToken();
    const stockMap = new Map<string, number>();

    this.logger.log(`Fetching stock for ${skus.length} SKUs...`);

    // Batch requests to avoid overwhelming the API
    const batchSize = 50;
    for (let i = 0; i < skus.length; i += batchSize) {
      const batch = skus.slice(i, i + batchSize);

      // Build search criteria for stockItems
      const searchCriteria = batch.map((sku, index) =>
        `searchCriteria[filter_groups][0][filters][${index}][field]=sku&searchCriteria[filter_groups][0][filters][${index}][value]=${encodeURIComponent(sku)}&searchCriteria[filter_groups][0][filters][${index}][condition_type]=eq`
      ).join('&');

      try {
        // Try MSI source-items endpoint first (Magento 2.3+)
        const response = await this.httpClient.get(
          `/rest/V1/inventory/source-items?${searchCriteria}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (response.data?.items) {
          for (const item of response.data.items) {
            const existingQty = stockMap.get(item.sku) || 0;
            stockMap.set(item.sku, existingQty + (item.quantity || 0));
          }
        }
      } catch {
        // Fall back to legacy stockItems endpoint
        for (const sku of batch) {
          try {
            const qty = await this.fetchStockBySku(sku);
            stockMap.set(sku, qty);
          } catch {
            stockMap.set(sku, 0);
          }
        }
      }

      // Progress log
      if ((i + batchSize) % 500 === 0 || i + batchSize >= skus.length) {
        this.logger.log(`Stock fetch progress: ${Math.min(i + batchSize, skus.length)}/${skus.length}`);
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.logger.log(`Fetched stock for ${stockMap.size} products`);
    return stockMap;
  }

  async fetchCustomers(
    pageSize: number = 50,
    currentPage: number = 1,
  ): Promise<MagentoCustomersResponse> {
    const token = await this.getAdminToken();

    try {
      const response = await this.httpClient.get(
        `/rest/V1/customers/search?searchCriteria[pageSize]=${pageSize}&searchCriteria[currentPage]=${currentPage}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 60000,
        },
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch customers from Magento', error);
      throw error;
    }
  }

  async fetchAllCustomers(): Promise<MagentoCustomer[]> {
    const allCustomers: MagentoCustomer[] = [];
    let currentPage = 1;
    const pageSize = 50;
    let totalCount = 0;

    this.logger.log('Starting to fetch all customers from Magento via REST API...');

    do {
      const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : '?';
      this.logger.log(`Fetching customer page ${currentPage} of ${totalPages}...`);
      const response = await this.fetchCustomers(pageSize, currentPage);

      allCustomers.push(...response.items);
      totalCount = response.total_count;
      this.logger.log(`Got ${response.items.length} customers (total so far: ${allCustomers.length}/${totalCount})`);
      currentPage++;

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    } while (allCustomers.length < totalCount);

    this.logger.log(`Fetched ${allCustomers.length} customers from Magento`);
    return allCustomers;
  }

  async fetchOrders(
    pageSize: number = 50,
    currentPage: number = 1,
  ): Promise<MagentoOrdersResponse> {
    const token = await this.getAdminToken();

    try {
      const response = await this.httpClient.get(
        `/rest/V1/orders?searchCriteria[pageSize]=${pageSize}&searchCriteria[currentPage]=${currentPage}&searchCriteria[sortOrders][0][field]=created_at&searchCriteria[sortOrders][0][direction]=DESC`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 60000,
        },
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch orders from Magento', error);
      throw error;
    }
  }

  async fetchAllOrders(): Promise<MagentoOrder[]> {
    const allOrders: MagentoOrder[] = [];
    let currentPage = 1;
    const pageSize = 100;
    let totalCount = 0;

    this.logger.log('Starting to fetch ALL orders from Magento via REST API...');

    do {
      const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : '?';
      this.logger.log(`Fetching orders page ${currentPage} of ${totalPages}...`);
      const response = await this.fetchOrders(pageSize, currentPage);
      allOrders.push(...response.items);
      totalCount = response.total_count;
      this.logger.log(
        `Got ${response.items.length} orders (total so far: ${allOrders.length}/${totalCount})`,
      );
      currentPage++;

      // Small rate-limit backoff between pages
      await new Promise((r) => setTimeout(r, 200));
    } while (allOrders.length < totalCount);

    this.logger.log(`Fetched ${allOrders.length} orders from Magento`);
    return allOrders;
  }

  // --- POS → Magento push helpers ---

  private async adminHeaders() {
    const token = await this.getAdminToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create an admin-initiated cart for a registered Magento customer.
   * Returns the quote/cart ID as a number.
   */
  async adminCreateCustomerCart(magentoCustomerId: number): Promise<number> {
    const headers = await this.adminHeaders();
    const res = await this.httpClient.post(
      `/rest/V1/customers/${magentoCustomerId}/carts`,
      {},
      { headers, timeout: 30000 },
    );
    // Response body is the quote id as a raw number
    return Number(res.data);
  }

  /**
   * Create a guest cart for walk-in POS orders.
   * Returns the guest cart token (string, not numeric).
   */
  async adminCreateGuestCart(): Promise<string> {
    const headers = await this.adminHeaders();
    const res = await this.httpClient.post(
      `/rest/V1/guest-carts`,
      {},
      { headers, timeout: 30000 },
    );
    return String(res.data);
  }

  async adminAddItemToCart(
    cartId: number | string,
    item: { sku: string; qty: number },
    isGuest: boolean,
  ): Promise<void> {
    const headers = await this.adminHeaders();
    const base = isGuest ? `/rest/V1/guest-carts/${cartId}` : `/rest/V1/carts/${cartId}`;
    await this.httpClient.post(
      `${base}/items`,
      {
        cartItem: {
          sku: item.sku,
          qty: item.qty,
          quote_id: String(cartId),
        },
      },
      { headers, timeout: 30000 },
    );
  }

  async adminSetShippingInformation(
    cartId: number | string,
    addressPayload: any,
    isGuest: boolean,
  ): Promise<void> {
    const headers = await this.adminHeaders();
    const base = isGuest ? `/rest/V1/guest-carts/${cartId}` : `/rest/V1/carts/${cartId}`;
    await this.httpClient.post(
      `${base}/shipping-information`,
      {
        addressInformation: addressPayload,
      },
      { headers, timeout: 30000 },
    );
  }

  async adminPlaceOrder(
    cartId: number | string,
    paymentMethod: string,
    isGuest: boolean,
    email?: string,
  ): Promise<number> {
    const headers = await this.adminHeaders();
    const base = isGuest ? `/rest/V1/guest-carts/${cartId}` : `/rest/V1/carts/${cartId}`;
    const body: any = {
      paymentMethod: { method: paymentMethod },
    };
    if (isGuest && email) body.email = email;
    const res = await this.httpClient.put(`${base}/order`, body, {
      headers,
      timeout: 60000,
    });
    // Response is the Magento order ID as a raw number
    return Number(res.data);
  }

  async adminAddOrderComment(
    magentoOrderId: number,
    comment: string,
  ): Promise<void> {
    try {
      const headers = await this.adminHeaders();
      await this.httpClient.post(
        `/rest/V1/orders/${magentoOrderId}/comments`,
        {
          statusHistory: {
            comment,
            is_customer_notified: 0,
            is_visible_on_front: 0,
          },
        },
        { headers, timeout: 30000 },
      );
    } catch (error) {
      // Non-fatal: log and move on, the order itself is already placed
      this.logger.warn(
        `Failed to add Magento order comment on order ${magentoOrderId}: ${error}`,
      );
    }
  }

  async fetchProductBySku(sku: string): Promise<MagentoProduct> {
    const token = await this.getAdminToken();
    // SKUs with slashes ("SES7070/1TC/BK") can't go in the URL path: the
    // Cloudways web server rejects encoded slashes with a bare 404 before
    // Magento ever sees them (Cloudflare used to smooth this over). The
    // search endpoint takes the SKU as a query parameter instead, with an
    // exact match, and returns the same product representation.
    const query =
      '/rest/V1/products?searchCriteria[filter_groups][0][filters][0][field]=sku' +
      `&searchCriteria[filter_groups][0][filters][0][value]=${encodeURIComponent(sku)}` +
      '&searchCriteria[filter_groups][0][filters][0][condition_type]=eq' +
      '&searchCriteria[pageSize]=1';
    try {
      const response = await this.httpClient.get(query, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      });
      const item = (response.data?.items || []).find(
        (p: MagentoProduct) => String(p.sku).toLowerCase() === sku.toLowerCase(),
      ) || response.data?.items?.[0];
      if (!item) {
        throw new Error(`Magento has no product with SKU ${sku}`);
      }
      return item;
    } catch (error) {
      this.logger.error(`Failed to fetch product ${sku} from Magento`, error);
      throw error;
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
