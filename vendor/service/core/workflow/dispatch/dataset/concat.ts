import type { SearchDataResponseItemType } from '../../../../../global/core/dataset/type';
import type {
  DispatchNodeResultType,
  ModuleDispatchProps
} from '../../../../../global/core/workflow/runtime/type';
import type { NodeInputKeyEnum } from '../../../../../global/core/workflow/constants';
import { NodeOutputKeyEnum } from '../../../../../global/core/workflow/constants';
import { datasetSearchResultConcat } from '../../../../../global/core/dataset/search/utils';
import { filterSearchResultsByMaxChars } from '../../utils';
import { DispatchNodeResponseKeyEnum } from '../../../../../global/core/workflow/runtime/constants';

type DatasetConcatProps = ModuleDispatchProps<
  {
    [NodeInputKeyEnum.datasetMaxTokens]: number;
  } & { [key: string]: SearchDataResponseItemType[] }
>;
type DatasetConcatResponse = DispatchNodeResultType<{
  [NodeOutputKeyEnum.datasetQuoteQA]: SearchDataResponseItemType[];
}>;

export async function dispatchDatasetConcat(
  props: DatasetConcatProps
): Promise<DatasetConcatResponse> {
  const {
    params: { limit = 5000, ...quoteMap }
  } = props as DatasetConcatProps;

  const quoteList = Object.values(quoteMap).filter((list) => Array.isArray(list));

  const rrfConcatResults = datasetSearchResultConcat(
    quoteList.map((list) => ({
      weight: 1,
      list
    }))
  );

  return {
    data: {
      [NodeOutputKeyEnum.datasetQuoteQA]: await filterSearchResultsByMaxChars(
        rrfConcatResults,
        limit
      )
    },
    [DispatchNodeResponseKeyEnum.nodeResponse]: {
      concatLength: rrfConcatResults.length
    }
  };
}
