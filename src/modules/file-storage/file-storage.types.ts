export type FileStorageRouteMigrationStatus = 'migrated' | 'pending';

export type FileStorageRouteDefinition = {
  sourcePath: string;
  targetPath: string;
  status: FileStorageRouteMigrationStatus;
};

export type FileStorageAuthCertResult = {
  teamId: string;
  tmbId?: string;
};

export type FileStorageAuthUserResult = {
  teamId: string;
  tmbId: string;
};
