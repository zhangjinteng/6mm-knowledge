import { HelperBotTypeEnum } from '../../../../../global/core/chat/helperBot/type';
import { dispatchTopAgent } from './topAgent';

export const dispatchMap = {
  [HelperBotTypeEnum.topAgent]: dispatchTopAgent
};
