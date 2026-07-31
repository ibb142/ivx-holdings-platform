import { createPaginator } from "@smithy/core";
import { CloudFrontClient } from "../CloudFrontClient";
import { ListTrustStoresCommand, } from "../commands/ListTrustStoresCommand";
export const paginateListTrustStores = createPaginator(CloudFrontClient, ListTrustStoresCommand, "Marker", "NextMarker", "MaxItems");
