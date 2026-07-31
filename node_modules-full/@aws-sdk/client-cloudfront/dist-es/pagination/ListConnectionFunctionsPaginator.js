import { createPaginator } from "@smithy/core";
import { CloudFrontClient } from "../CloudFrontClient";
import { ListConnectionFunctionsCommand, } from "../commands/ListConnectionFunctionsCommand";
export const paginateListConnectionFunctions = createPaginator(CloudFrontClient, ListConnectionFunctionsCommand, "Marker", "NextMarker", "MaxItems");
