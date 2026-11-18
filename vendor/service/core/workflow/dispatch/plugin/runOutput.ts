import type { ModuleDispatchProps } from '../../../../../global/core/workflow/runtime/type';
import { type DispatchNodeResultType } from '../../../../../global/core/workflow/runtime/type';
import { DispatchNodeResponseKeyEnum } from '../../../../../global/core/workflow/runtime/constants';

export type PluginOutputProps = ModuleDispatchProps<{
  [key: string]: any;
}>;
export type PluginOutputResponse = DispatchNodeResultType<{}>;

export const dispatchPluginOutput = (props: PluginOutputProps): PluginOutputResponse => {
  const { params } = props;

  return {
    [DispatchNodeResponseKeyEnum.nodeResponse]: {
      pluginOutput: params
    }
  };
};
