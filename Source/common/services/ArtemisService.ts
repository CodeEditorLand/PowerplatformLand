/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 */

import fetch, { RequestInit } from "node-fetch";

import { COPILOT_UNAVAILABLE } from "../copilot/constants";
import { sendTelemetryEvent } from "../copilot/telemetry/copilotTelemetry";
import {
	CopilotArtemisFailureEvent,
	CopilotArtemisSuccessEvent,
} from "../copilot/telemetry/telemetryConstants";
import {
	isCopilotDisabledInGeo,
	isCopilotSupportedInGeo,
} from "../copilot/utils/copilotUtil";
import { ITelemetry } from "../OneDSLoggerTelemetry/telemetry/ITelemetry";
import { BAPService } from "./BAPService";
import { ServiceEndpointCategory } from "./Constants";
import {
	IArtemisAPIOrgResponse,
	IArtemisServiceEndpointInformation,
	IArtemisServiceResponse,
	IIntelligenceAPIEndpointInformation,
} from "./Interfaces";

export class ArtemisService {
	public static async getIntelligenceEndpoint(
		orgId: string,
		telemetry: ITelemetry,
		sessionID: string,
		environmentId: string,
	): Promise<IIntelligenceAPIEndpointInformation> {
		const artemisResponse = await ArtemisService.getArtemisResponse(
			orgId,
			telemetry,
			sessionID,
		);

		if (artemisResponse === null) {
			return {
				intelligenceEndpoint: null,
				geoName: null,
				crossGeoDataMovementEnabledPPACFlag: false,
			};
		}
		const { geoName, environment, clusterNumber } =
			artemisResponse.response as unknown as IArtemisAPIOrgResponse;
		sendTelemetryEvent(telemetry, {
			eventName: CopilotArtemisSuccessEvent,
			copilotSessionId: sessionID,
			geoName: String(geoName),
			orgId: orgId,
		});

		const crossGeoDataMovementEnabledPPACFlag =
			await BAPService.getCrossGeoCopilotDataMovementEnabledFlag(
				artemisResponse.stamp,
				telemetry,
				environmentId,
			);

		if (isCopilotDisabledInGeo().includes(geoName)) {
			return {
				intelligenceEndpoint: COPILOT_UNAVAILABLE,
				geoName: geoName,
				crossGeoDataMovementEnabledPPACFlag:
					crossGeoDataMovementEnabledPPACFlag,
			};
		} else if (crossGeoDataMovementEnabledPPACFlag === true) {
			// Do nothing - we can make this call cross geo
		} else if (!isCopilotSupportedInGeo().includes(geoName)) {
			return {
				intelligenceEndpoint: COPILOT_UNAVAILABLE,
				geoName: geoName,
				crossGeoDataMovementEnabledPPACFlag:
					crossGeoDataMovementEnabledPPACFlag,
			};
		}

		const intelligenceEndpoint = `https://aibuildertextapiservice.${geoName}-${"il" + clusterNumber}.gateway.${environment}.island.powerapps.com/v1.0/${orgId}/appintelligence/chat`;

		return {
			intelligenceEndpoint: intelligenceEndpoint,
			geoName: geoName,
			crossGeoDataMovementEnabledPPACFlag:
				crossGeoDataMovementEnabledPPACFlag,
		};
	}

	// Function to fetch Artemis response
	public static async getArtemisResponse(
		orgId: string,
		telemetry: ITelemetry,
		sessionID: string,
	): Promise<IArtemisServiceResponse | null> {
		const endpointDetails = ArtemisService.convertGuidToUrls(orgId);

		const artemisResponses = await ArtemisService.fetchIslandInfo(
			endpointDetails,
			telemetry,
			sessionID,
		);

		if (artemisResponses === null || artemisResponses.length === 0) {
			return null;
		}

		return artemisResponses[0];
	}

	static async fetchIslandInfo(
		endpointDetails: IArtemisServiceEndpointInformation[],
		telemetry: ITelemetry,
		sessionID: string,
	): Promise<IArtemisServiceResponse[] | null> {
		const requestInit: RequestInit = {
			method: "GET",
			redirect: "follow",
		};

		try {
			const promises = endpointDetails.map(async (endpointDetail) => {
				try {
					const response = await fetch(
						endpointDetail.endpoint,
						requestInit,
					);

					if (!response.ok) {
						throw new Error("Request failed");
					}
					return {
						stamp: endpointDetail.stamp,
						response:
							(await response.json()) as IArtemisAPIOrgResponse,
					};
				} catch (error) {
					return null;
				}
			});

			const results = await Promise.all(promises);

			const successfulResponses = results.filter(
				(result) => result !== null && result.response !== null,
			);

			return successfulResponses as IArtemisServiceResponse[];
		} catch (error) {
			sendTelemetryEvent(telemetry, {
				eventName: CopilotArtemisFailureEvent,
				copilotSessionId: sessionID,
				error: error as Error,
			});

			return null;
		}
	}

	/**
	 * @param orgId
	 * @returns urls
	 * ex. orgId: c7809087-d9b8-4a00-a78a-a4b901caa23f
	 * TST (note single character zone):  https://c7809087d9b84a00a78aa4b901caa23.f.organization.api.test.powerplatform.com/artemis
	 * PreProd (note single character zone):  https://c7809087d9b84a00a78aa4b901caa23.f.organization.api.preprod.powerplatform.com/artemis
	 * Prod: https:// c7809087d9b84a00a78aa4b901caa2.3f.organization.api.powerplatform.com/artemis
	 */
	static convertGuidToUrls(
		orgId: string,
	): IArtemisServiceEndpointInformation[] {
		const updatedOrgId = orgId.replace(/-/g, "");

		const domain = updatedOrgId.slice(0, -1);

		const domainProd = updatedOrgId.slice(0, -2);

		const nonProdSegment = updatedOrgId.slice(-1);

		const prodSegment = updatedOrgId.slice(-2);

		const tstUrl = `https://${domain}.${nonProdSegment}.organization.api.test.powerplatform.com/gateway/cluster?api-version=1`;

		const preprodUrl = `https://${domain}.${nonProdSegment}.organization.api.preprod.powerplatform.com/gateway/cluster?api-version=1`;

		const prodUrl = `https://${domainProd}.${prodSegment}.organization.api.powerplatform.com/gateway/cluster?api-version=1`;

		const gccUrl = `https://${domain}.${nonProdSegment}.organization.api.gov.powerplatform.microsoft.us/gateway/cluster?api-version=1`;

		const highUrl = `https://${domain}.${nonProdSegment}.organization.api.high.powerplatform.microsoft.us/gateway/cluster?api-version=1`;

		const mooncakeUrl = `https://${domain}.${nonProdSegment}.organization.api.powerplatform.partner.microsoftonline.cn/gateway/cluster?app-version=1`;

		const dodUrl = `https://${domain}.${nonProdSegment}.organization.api.appsplatform.us/gateway/cluster?app-version=1`;

		return [
			{ stamp: ServiceEndpointCategory.TEST, endpoint: tstUrl },
			{ stamp: ServiceEndpointCategory.PREPROD, endpoint: preprodUrl },
			{ stamp: ServiceEndpointCategory.PROD, endpoint: prodUrl },
			{ stamp: ServiceEndpointCategory.GCC, endpoint: gccUrl },
			{ stamp: ServiceEndpointCategory.HIGH, endpoint: highUrl },
			{ stamp: ServiceEndpointCategory.MOONCAKE, endpoint: mooncakeUrl },
			{ stamp: ServiceEndpointCategory.DOD, endpoint: dodUrl },
		];
	}
}
