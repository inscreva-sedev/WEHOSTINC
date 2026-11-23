import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import PortfolioProjectModel from '@/lib/models/PortfolioProject';
import { portfolioProjects, PortfolioProject } from '@/lib/portfolioData';
import { requireAdmin } from '@/lib/serverAuth';

export const dynamic = 'force-dynamic';

function buildSeedProjects(): PortfolioProject[] {
  const now = new Date().toISOString();
  return portfolioProjects.map((project, index) => ({
    ...project,
    url: project.url || '',
    linkDisabled: Boolean(project.linkDisabled),
    order: project.order ?? index + 1,
    active: project.active ?? true,
    createdAt: now,
    updatedAt: now,
  }));
}

let fallbackProjects: PortfolioProject[] = buildSeedProjects();

function extractDomainFromUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const withProto = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(withProto);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function sanitizeUrl(rawUrl?: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function ensureSeededAndFetch(includeInactive: boolean): Promise<PortfolioProject[]> {
  try {
    await connectDB();
    let docs = await PortfolioProjectModel.find({}).sort({ order: 1, createdAt: 1 }).lean();

    if (!docs || docs.length === 0) {
      const seed = buildSeedProjects();
      try {
        await PortfolioProjectModel.insertMany(seed, { ordered: false });
        docs = await PortfolioProjectModel.find({}).sort({ order: 1, createdAt: 1 }).lean();
      } catch (seedErr) {
        console.warn('[Portfolio API] Seed warning:', seedErr);
      }
    }

    if (docs && docs.length > 0) {
      const normalized = docs.map((doc: any, idx: number) => ({
        id: String(doc.id || doc._id),
        name: String(doc.name || ''),
        domain: String(doc.domain || ''),
        url: String(doc.url || ''),
        linkDisabled: Boolean(doc.linkDisabled),
        categoryPt: String(doc.categoryPt || 'Website'),
        categoryEn: String(doc.categoryEn || doc.categoryPt || 'Website'),
        descriptionPt: String(doc.descriptionPt || ''),
        descriptionEn: String(doc.descriptionEn || doc.descriptionPt || ''),
        image: String(doc.image || '/portfolio/primeauction.jpg'),
        quoteHref: String(doc.quoteHref || '/site-quote'),
        order: typeof doc.order === 'number' ? doc.order : idx + 1,
        active: doc.active !== false,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }));
      fallbackProjects = normalized;
      return includeInactive ? normalized : normalized.filter((p) => p.active !== false);
    }
  } catch (err) {
    console.warn('[Portfolio API] MongoDB fallback:', err);
  }

  return includeInactive
    ? fallbackProjects
    : fallbackProjects.filter((p) => p.active !== false);
}

// GET - Lista projetos do portfólio (?all=1 exige admin para incluir ocultos)
export async function GET(req: NextRequest) {
  const includeAll = req.nextUrl.searchParams.get('all') === '1';

  if (includeAll) {
    const adminAuth = await requireAdmin(req);
    if (adminAuth.error) return adminAuth.error;
  }

  const projects = await ensureSeededAndFetch(includeAll);
  return NextResponse.json({ success: true, projects });
}

// POST - Criar novo projeto (admin)
export async function POST(req: NextRequest) {
  const adminAuth = await requireAdmin(req);
  if (adminAuth.error) return adminAuth.error;

  try {
    const body = await req.json();
    const name = String(body.name || '').trim();
    const categoryPt = String(body.categoryPt || '').trim();
    const descriptionPt = String(body.descriptionPt || '').trim();
    const image = String(body.image || '').trim();

    if (!name || !categoryPt || !descriptionPt || !image) {
      return NextResponse.json(
        { success: false, error: 'Nome, categoria, descrição e imagem são obrigatórios.' },
        { status: 400 }
      );
    }

    const url = sanitizeUrl(body.url);
    const domain = String(body.domain || '').trim() || extractDomainFromUrl(url);
    const now = new Date().toISOString();

    await connectDB();
    const existingCount = await PortfolioProjectModel.countDocuments({});
    const slugBase = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'projeto';
    const id = String(body.id || `${slugBase}-${Date.now().toString(36)}`);

    const newProject = await PortfolioProjectModel.create({
      id,
      name,
      domain,
      url,
      linkDisabled: Boolean(body.linkDisabled),
      categoryPt,
      categoryEn: String(body.categoryEn || '').trim() || categoryPt,
      descriptionPt,
      descriptionEn: String(body.descriptionEn || '').trim() || descriptionPt,
      image,
      quoteHref: String(body.quoteHref || '/site-quote').trim() || '/site-quote',
      order: typeof body.order === 'number' ? body.order : existingCount + 1,
      active: body.active !== false,
      createdAt: now,
      updatedAt: now,
    });

    const projects = await ensureSeededAndFetch(true);
    return NextResponse.json({ success: true, project: newProject, projects });
  } catch (error) {
    console.error('[Portfolio API POST] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao criar projeto no portfólio.' },
      { status: 500 }
    );
  }
}

// PUT - Atualizar projeto ou reordenar (admin)
export async function PUT(req: NextRequest) {
  const adminAuth = await requireAdmin(req);
  if (adminAuth.error) return adminAuth.error;

  try {
    const body = await req.json();
    await connectDB();

    if (body.action === 'reorder' && Array.isArray(body.orderedIds)) {
      const now = new Date().toISOString();
      await Promise.all(
        body.orderedIds.map((id: string, index: number) =>
          PortfolioProjectModel.updateOne(
            { id: String(id) },
            { $set: { order: index + 1, updatedAt: now } }
          )
        )
      );
      const projects = await ensureSeededAndFetch(true);
      return NextResponse.json({ success: true, projects });
    }

    const id = String(body.id || '').trim();
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID do projeto é obrigatório.' },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.categoryPt !== undefined) updates.categoryPt = String(body.categoryPt).trim();
    if (body.categoryEn !== undefined) {
      updates.categoryEn = String(body.categoryEn).trim() || updates.categoryPt;
    }
    if (body.descriptionPt !== undefined) updates.descriptionPt = String(body.descriptionPt).trim();
    if (body.descriptionEn !== undefined) {
      updates.descriptionEn = String(body.descriptionEn).trim() || updates.descriptionPt;
    }
    if (body.image !== undefined) updates.image = String(body.image).trim();
    if (body.quoteHref !== undefined) updates.quoteHref = String(body.quoteHref).trim() || '/site-quote';
    if (body.linkDisabled !== undefined) updates.linkDisabled = Boolean(body.linkDisabled);
    if (body.active !== undefined) updates.active = Boolean(body.active);
    if (typeof body.order === 'number') updates.order = body.order;

    if (body.url !== undefined) {
      updates.url = sanitizeUrl(body.url);
    }
    if (body.domain !== undefined) {
      const cleanDomain = String(body.domain).trim();
      updates.domain = cleanDomain || (updates.url ? extractDomainFromUrl(updates.url) : '');
    }

    const updated = await PortfolioProjectModel.findOneAndUpdate(
      { id },
      { $set: updates },
      { new: true }
    ).lean();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Projeto não encontrado.' },
        { status: 404 }
      );
    }

    const projects = await ensureSeededAndFetch(true);
    return NextResponse.json({ success: true, project: updated, projects });
  } catch (error) {
    console.error('[Portfolio API PUT] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar projeto.' },
      { status: 500 }
    );
  }
}

// DELETE - Remover projeto (admin)
export async function DELETE(req: NextRequest) {
  const adminAuth = await requireAdmin(req);
  if (adminAuth.error) return adminAuth.error;

  try {
    let id = req.nextUrl.searchParams.get('id') || '';
    if (!id) {
      const body = await req.json().catch(() => ({}));
      id = String(body.id || '');
    }
    id = id.trim();

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID do projeto é obrigatório.' },
        { status: 400 }
      );
    }

    await connectDB();
    await PortfolioProjectModel.deleteOne({ id });
    const projects = await ensureSeededAndFetch(true);
    return NextResponse.json({ success: true, projects });
  } catch (error) {
    console.error('[Portfolio API DELETE] Erro:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao eliminar projeto.' },
      { status: 500 }
    );
  }
}
