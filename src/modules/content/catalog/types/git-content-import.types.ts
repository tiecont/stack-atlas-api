import type { ContentDocumentV1 } from './content-document';

export type GitContentImportMode = 'dry-run' | 'apply' | 'verify';

export interface GitContentImportIssue {
  code: string;
  message: string;
  sourcePath: string;
}

export interface GitContentInventoryFile {
  path: string;
  sha256: string;
}

export interface GitContentPathModule {
  id: string;
  order: number;
  articleIds: string[];
  sourceMetadata: Record<string, unknown>;
}

export interface GitContentPathRecord {
  id: string;
  sourcePath: string;
  sourceMetadata: Record<string, unknown>;
  modules: GitContentPathModule[];
  legacyIndexUrls: string[];
}

export interface GitContentRelationships {
  domain: string | null;
  category: string | null;
  tags: string[];
  authors: string[];
  difficulty: string | null;
  labs: string[];
  kubernetes: Record<string, unknown> | null;
  review: Record<string, unknown> | null;
  learningPaths: { pathId: string; moduleId: string }[];
  prerequisites: string[];
  related: string[];
  legacyUrls: string[];
}

export interface GitContentSourceArticle {
  sourceId: string | null;
  contentKey: string | null;
  slug: string | null;
  title: string | null;
  description: string | null;
  sourceStatus: string | null;
  document: ContentDocumentV1 | null;
  sourceFiles: string[];
  sourceChecksumSha256: string | null;
  relationships: GitContentRelationships;
  warnings: GitContentImportIssue[];
  errors: GitContentImportIssue[];
}

export interface GitContentSnapshot {
  repository: 'tiecont/stack-atlas';
  commitSha: string;
  sourceRoot: string;
  inventory: GitContentInventoryFile[];
  articles: GitContentSourceArticle[];
  pathRecords: GitContentPathRecord[];
  sourceErrors: GitContentImportIssue[];
}

export interface GitContentImportArticleResult {
  sourceId: string | null;
  contentKey: string | null;
  sourceFiles: string[];
  status:
    | 'ready'
    | 'already_imported'
    | 'imported'
    | 'verified'
    | 'skipped'
    | 'failed';
  message?: string;
}

export interface GitContentRelationshipMismatch {
  contentKey: string;
  relationship:
    | 'topic_metadata'
    | 'article_metadata'
    | 'lab_reference'
    | 'path_membership'
    | 'prerequisite'
    | 'legacy_redirect'
    | 'path_metadata';
  sourceValue: unknown;
  reason: string;
}

export interface GitContentImportReport {
  source: {
    repository: 'tiecont/stack-atlas';
    commitSha: string;
    inventory: GitContentInventoryFile[];
  };
  mode: GitContentImportMode;
  summary: {
    discovered: number;
    importable: number;
    imported: number;
    skipped: number;
    failed: number;
    unsupportedConstructs: number;
    relationshipMismatches: number;
  };
  articles: GitContentImportArticleResult[];
  unsupportedConstructs: GitContentImportIssue[];
  relationshipMismatches: GitContentRelationshipMismatch[];
  sourceErrors: GitContentImportIssue[];
}
