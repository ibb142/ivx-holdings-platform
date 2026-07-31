import { Paginator } from "@smithy/types";
import {
  ListConnectionFunctionsCommandInput,
  ListConnectionFunctionsCommandOutput,
} from "../commands/ListConnectionFunctionsCommand";
import { CloudFrontPaginationConfiguration } from "./Interfaces";
export declare const paginateListConnectionFunctions: (
  config: CloudFrontPaginationConfiguration,
  input: ListConnectionFunctionsCommandInput,
  ...rest: any[]
) => Paginator<ListConnectionFunctionsCommandOutput>;
