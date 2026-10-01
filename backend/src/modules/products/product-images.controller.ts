import {
  Controller,
  Get,
  Query,
  Res,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MagentoService } from '../sync/magento.service';

// Product photos live on the Magento site, and the tills' browsers can't
// load them while Cloudflare's Under Attack Mode is on: an <img> can't
// answer the JavaScript challenge, so every photo broke (Sally, 1 Oct
// 2026). The POS server CAN reach Magento (it goes to the origin
// directly), so it fetches each image once, keeps a copy on disk and
// serves it from here. Lives at /product-image (not under /products,
// whose :id route would swallow it). Public route on purpose — <img> tags can't send
// the login token — but it only ever fetches from the Magento media
// folder, and only serves what it fetched.
const CACHE_DIR = path.join(process.cwd(), 'image-cache');
const MAX_BYTES = 15 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

@ApiTags('products')
@Controller('product-image')
export class ProductImagesController {
  private readonly logger = new Logger(ProductImagesController.name);
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(private readonly magentoService: MagentoService) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  private allowedPrefixes(): string[] {
    const base = (this.magentoService.getBaseUrl() || '').replace(/\/$/, '');
    if (!base) return [];
    const bare = base.replace(/^https?:\/\/www\./i, 'https://');
    const www = base.replace(/^https?:\/\/(?!www\.)/i, 'https://www.');
    return Array.from(
      new Set([base, bare, www].flatMap((b) => [`${b}/pub/media/`, `${b}/media/`])),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Serve a Magento product image via the POS server (cached)' })
  async image(@Query('src') src: string, @Res() res: Response) {
    const url = (src || '').trim();
    const prefixes = this.allowedPrefixes();
    if (!url || !prefixes.some((p) => url.toLowerCase().startsWith(p.toLowerCase()))) {
      throw new BadRequestException('Not a product image URL');
    }
    const ext = (path.extname(new URL(url).pathname) || '.jpg').toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'image/jpeg';
    const key = crypto.createHash('sha1').update(url).digest('hex');
    const file = path.join(CACHE_DIR, `${key}${ext}`);

    if (!fs.existsSync(file)) {
      try {
        await this.fetchToCache(url, file);
      } catch (err) {
        this.logger.warn(
          `Image fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new NotFoundException('Image not available');
      }
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    fs.createReadStream(file).pipe(res);
  }

  // One download per URL even when a grid of tiles asks at the same time.
  private fetchToCache(url: string, file: string): Promise<string> {
    const existing = this.inflight.get(url);
    if (existing) return existing;
    const p = (async () => {
      const r = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: MAX_BYTES,
        maxRedirects: 3,
        validateStatus: (s) => s === 200,
        headers: { Accept: 'image/*' },
      });
      const ct = String(r.headers['content-type'] || '');
      if (!ct.startsWith('image/')) {
        throw new Error(`not an image (${ct.slice(0, 40) || 'no content-type'})`);
      }
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, Buffer.from(r.data));
      fs.renameSync(tmp, file);
      return file;
    })().finally(() => this.inflight.delete(url));
    this.inflight.set(url, p);
    return p;
  }
}
