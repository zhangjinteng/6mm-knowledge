import type { FileStorageRouteDefinition } from '@/modules/file-storage/file-storage.types.js';

export const fileStorageRouteDefinitions: FileStorageRouteDefinition[] = [
  {
    targetPath: '/api/common/file/presignAvatarPostUrl',
    sourcePath: 'projects/app/src/pages/api/common/file/presignAvatarPostUrl.ts',
    status: 'migrated'
  },
  {
    targetPath: '/api/common/file/presignTempFilePostUrl',
    sourcePath: 'projects/app/src/pages/api/common/file/presignTempFilePostUrl.ts',
    status: 'migrated'
  },
  {
    targetPath: '/api/common/file/read/:filename',
    sourcePath: 'projects/app/src/pages/api/common/file/read/[filename].ts',
    status: 'migrated'
  },
  {
    targetPath: '/api/system/file/:jwt',
    sourcePath: 'projects/app/src/pages/api/system/file/[jwt].ts',
    status: 'migrated'
  },
  {
    targetPath: '/api/system/file/download/:token',
    sourcePath: 'projects/app/src/pages/api/system/file/download/[token].ts',
    status: 'migrated'
  },
  {
    targetPath: '/api/system/file/upload/:token',
    sourcePath: 'projects/app/src/pages/api/system/file/upload/[token].ts',
    status: 'migrated'
  },
  {
    targetPath: '/api/system/img/*',
    sourcePath: 'projects/app/src/pages/api/system/img/[...id].ts',
    status: 'migrated'
  }
];
