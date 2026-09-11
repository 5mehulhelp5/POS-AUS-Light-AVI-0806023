import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { productsApi } from '../../services/api';

export interface Product {
  id: number;
  magentoId: number;
  sku: string;
  name: string;
  price: number;
  specialPrice: number | null;
  // Sale-window dates from Magento. Used by isProductOnSale() so the
  // SALE tag, cart, and modal hide a stale special price as soon as the
  // to-date passes (no need to wait for a sync).
  specialPriceFrom?: string | null;
  specialPriceTo?: string | null;
  // Server-precomputed flag — handy as a fallback, but the frontend also
  // re-checks the date window itself for freshness.
  isOnSale?: boolean;
  effectivePrice?: number;
  // Wholesale cost from Magento — used by the cart to warn when a trade
  // discount drops the unit price below cost + 30% (the minimum margin).
  cost?: number | null;
  // Brand / wholesaler name from Magento's manufacturer attribute (e.g.
  // "Havit"). Shown on the product detail modal so staff know which
  // supplier to reach when they need to reorder.
  brand?: string | null;
  stockQty: number;
  isInStock: boolean;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  barcode: string | null;
  categories: Array<{ id: number; name: string }>;
}

// Treat as on-sale only when specialPrice is set, > 0, strictly less
// than price, and today is inside the (optional) from/to window.
// Mirrors Product.isOnSale on the backend so the cart, SALE badge, and
// server's payment-check all agree.
export function isProductOnSale(p: {
  price: number | string | null | undefined;
  specialPrice: number | string | null | undefined;
  specialPriceFrom?: Date | string | null;
  specialPriceTo?: Date | string | null;
}): boolean {
  if (p.specialPrice == null || p.price == null) return false;
  const sp = Number(p.specialPrice);
  const reg = Number(p.price);
  if (!(sp > 0) || !(reg > 0)) return false;
  if (sp >= reg) return false;
  const now = Date.now();
  if (p.specialPriceFrom) {
    const f = new Date(p.specialPriceFrom).getTime();
    if (Number.isFinite(f) && f > now) return false;
  }
  if (p.specialPriceTo) {
    // `to` is a date (no time) — include the whole day
    const t = new Date(p.specialPriceTo).getTime();
    if (Number.isFinite(t) && t + 24 * 60 * 60 * 1000 - 1 < now) return false;
  }
  return true;
}

export function effectiveProductPrice(p: {
  price: number | string | null | undefined;
  specialPrice: number | string | null | undefined;
  specialPriceFrom?: Date | string | null;
  specialPriceTo?: Date | string | null;
}): number {
  return isProductOnSale(p) ? Number(p.specialPrice) : Number(p.price);
}

export interface Category {
  id: number;
  magentoId: number;
  name: string;
  children?: Category[];
}

interface CategoryBreadcrumb {
  id: number;
  name: string;
}

interface ProductsState {
  items: Product[];
  categories: Category[];
  subcategories: Category[];
  selectedCategory: number | null;
  selectedSubcategory: number | null;
  parentCategoryName: string | null;
  categoryPath: CategoryBreadcrumb[]; // Breadcrumb trail for deep navigation
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const initialState: ProductsState = {
  items: [],
  categories: [],
  subcategories: [],
  selectedCategory: null,
  selectedSubcategory: null,
  parentCategoryName: null,
  categoryPath: [],
  searchQuery: '',
  isLoading: false,
  error: null,
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  },
};

// Async thunks
export const fetchProducts = createAsyncThunk(
  'products/fetchProducts',
  async (
    params: {
      search?: string;
      category?: number;
      page?: number;
      limit?: number;
      // Default true — out-of-stock (treated as discontinued) is hidden
      // from the grid/search. Pass undefined or false to surface them
      // (e.g. an admin "Show discontinued" toggle). Barcode and SKU
      // lookups are unaffected and still return any product.
      inStock?: boolean;
    },
    { rejectWithValue }
  ) => {
    try {
      const withDefault = {
        inStock: true,
        ...params,
      };
      const response = await productsApi.getProducts(withDefault);
      return response.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.error?.message || 'Failed to fetch products'
      );
    }
  }
);

export const fetchCategories = createAsyncThunk(
  'products/fetchCategories',
  async (_, { rejectWithValue }) => {
    try {
      const response = await productsApi.getCategories();
      return response.data.data.categories;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.error?.message || 'Failed to fetch categories'
      );
    }
  }
);

export const fetchSubcategories = createAsyncThunk(
  'products/fetchSubcategories',
  async (categoryId: number, { rejectWithValue }) => {
    try {
      const response = await productsApi.getSubcategories(categoryId);
      return response.data.data;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.error?.message || 'Failed to fetch subcategories'
      );
    }
  }
);

export const searchByBarcode = createAsyncThunk(
  'products/searchByBarcode',
  async (barcode: string, { rejectWithValue }) => {
    try {
      const response = await productsApi.getByBarcode(barcode);
      if (!response.data.success) {
        return rejectWithValue('Product not found');
      }
      return response.data.data.product;
    } catch (error: any) {
      return rejectWithValue(
        error.response?.data?.error?.message || 'Product not found'
      );
    }
  }
);

const productsSlice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setSelectedCategory: (state, action: PayloadAction<number | null>) => {
      state.selectedCategory = action.payload;
      state.selectedSubcategory = null;
      state.subcategories = [];
      state.parentCategoryName = null;
      state.categoryPath = [];
    },
    setSelectedSubcategory: (state, action: PayloadAction<number | null>) => {
      state.selectedSubcategory = action.payload;
    },
    // Navigate into a subcategory (for deep navigation)
    navigateToCategory: (state, action: PayloadAction<{ id: number; name: string }>) => {
      state.categoryPath.push(action.payload);
      state.subcategories = [];
      state.selectedSubcategory = null;
    },
    // Go back to a specific level in the breadcrumb
    navigateToBreadcrumb: (state, action: PayloadAction<number>) => {
      const index = action.payload;
      if (index < 0) {
        // Go back to main categories
        state.categoryPath = [];
        state.subcategories = [];
        state.selectedSubcategory = null;
        state.parentCategoryName = null;
      } else {
        // Go to specific level
        state.categoryPath = state.categoryPath.slice(0, index + 1);
        state.subcategories = [];
        state.selectedSubcategory = null;
      }
    },
    // Keep the grid's copy in step after a cost edit in the detail modal,
    // so the cart's cost+30% margin guard uses the new figure without a
    // refetch.
    setProductCost: (
      state,
      action: PayloadAction<{ id: number; cost: number | null }>,
    ) => {
      const p = state.items.find((x) => x.id === action.payload.id);
      if (p) p.cost = action.payload.cost;
    },
    clearSubcategories: (state) => {
      state.subcategories = [];
      state.selectedSubcategory = null;
      state.parentCategoryName = null;
      state.categoryPath = [];
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch products
      .addCase(fetchProducts.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchProducts.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.data.products;
        state.pagination = action.payload.data.pagination;
      })
      .addCase(fetchProducts.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // Fetch categories
      .addCase(fetchCategories.fulfilled, (state, action) => {
        state.categories = action.payload;
      })
      // Fetch subcategories
      .addCase(fetchSubcategories.fulfilled, (state, action) => {
        state.subcategories = action.payload.subcategories;
        state.parentCategoryName = action.payload.parentCategory?.name || null;
      })
      // Search by barcode
      .addCase(searchByBarcode.rejected, (state, action) => {
        state.error = action.payload as string;
      });
  },
});

export const {
  setSearchQuery,
  setSelectedCategory,
  setSelectedSubcategory,
  navigateToCategory,
  navigateToBreadcrumb,
  clearSubcategories,
  setProductCost,
  clearError,
} = productsSlice.actions;

export default productsSlice.reducer;
