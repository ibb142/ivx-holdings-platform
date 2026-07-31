import { Paginator } from "@smithy/types";
import {
  ListDistributionsByTrustStoreCommandInput,
  ListDistributionsByTrustStoreCommandOutput,
} from "../commands/ListDistributionsByTrustStoreCommand";
import { CloudFrontPaginationConfiguration } from "./Interfaces";
export declare const paginateListDistributionsByTrustStore: (
  config: CloudFrontPaginationConfiguration,
  input: ListDistributionsByTrustStoreCommandInput,
  ...rest: any[]
) => Paginator<ListDistributionsByTrustStoreCommandOutput>;
