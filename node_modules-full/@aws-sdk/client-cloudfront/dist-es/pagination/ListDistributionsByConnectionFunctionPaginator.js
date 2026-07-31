import { createPaginator } from "@smithy/core";
import { CloudFrontClient } from "../CloudFrontClient";
import { ListDistributionsByConnectionFunctionCommand, } from "../commands/ListDistributionsByConnectionFunctionCommand";
export const paginateListDistributionsByConnectionFunction = createPaginator(CloudFrontClient, ListDistributionsByConnectionFunctionCommand, "Marker", "DistributionList.NextMarker", "MaxItems");
