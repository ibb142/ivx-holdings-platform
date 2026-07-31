import { Paginator } from "@smithy/types";
import {
  ListTrustStoresCommandInput,
  ListTrustStoresCommandOutput,
} from "../commands/ListTrustStoresCommand";
import { CloudFrontPaginationConfiguration } from "./Interfaces";
export declare const paginateListTrustStores: (
  config: CloudFrontPaginationConfiguration,
  input: ListTrustStoresCommandInput,
  ...rest: any[]
) => Paginator<ListTrustStoresCommandOutput>;
