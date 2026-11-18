import { POST } from "../../../../../vendor/service/common/api/plusRequest";
import { type SendInform2UserProps } from "../../../../../vendor/global/support/user/inform/type";
import { FastGPTProUrl } from "../../../../../vendor/service/common/system/constants";

export function sendOneInform(data: SendInform2UserProps) {
  if (!FastGPTProUrl) return;
  return POST('/support/user/inform/create', data);
}
