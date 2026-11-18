import type { AppTemplateSchemaType } from '../../../../global/core/app/type';

declare global {
  var appTemplates: AppTemplateSchemaType[];
  var templatesRefreshTime: number;
}

export {};
