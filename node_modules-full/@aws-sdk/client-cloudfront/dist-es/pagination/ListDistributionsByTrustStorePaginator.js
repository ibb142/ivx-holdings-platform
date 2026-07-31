import { createPaginator } from "@smithy/core";
import { CloudFrontClient } from "../CloudFrontClient";
import { ListDistributionsByTrustStoreCommand, } from "../commands/ListDistributionsByTrustStoreCommand";
export const paginateListDistributionsByTrustStore = createPaginator(CloudFrontClient, ListDistributionsByTrustStoreCommand, "Marker", "DistributionList.NextMarker", "MaxItems");
