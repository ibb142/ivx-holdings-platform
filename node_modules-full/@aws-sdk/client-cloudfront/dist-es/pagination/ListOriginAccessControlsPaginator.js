import { createPaginator } from "@smithy/core";
import { CloudFrontClient } from "../CloudFrontClient";
import { ListOriginAccessControlsCommand, } from "../commands/ListOriginAccessControlsCommand";
export const paginateListOriginAccessControls = createPaginator(CloudFrontClient, ListOriginAccessControlsCommand, "Marker", "OriginAccessControlList.NextMarker", "MaxItems");
