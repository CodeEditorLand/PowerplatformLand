/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 */

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();
import {
    sendAPIFailureTelemetry,
    sendAPISuccessTelemetry,
    sendAPITelemetry,
    sendErrorTelemetry
} from '../telemetry/webExtensionTelemetry';
import { GetFileNameWithExtension, useBase64 } from '../utility/CommonUtility';
import {
    getRequestURL,
    updateEntityId
} from '../utility/UrlBuilder';
import { getHeader } from './authenticationProvider';
import * as Constants from './constants';
import { PORTALS_URI_SCHEME } from './constants';
import { ERRORS, showErrorDialog } from './errorHandler';
import { PortalsFS } from './fileSystemProvider';
import { dataSourcePropertiesMap } from './localStore';
import { SaveEntityDetails } from './portalSchemaInterface';
import { registerSaveProvider } from './remoteSaveProvider';
let saveDataMap = new Map<string, SaveEntityDetails>();

export async function fetchData(
    accessToken: string,
    entity: string,
    entityId: string,
    queryParamsMap: Map<string, string>,
    entitiesSchemaMap: Map<string, Map<string, string>>,
    languageIdCodeMap: Map<string, string>,
    portalFs: PortalsFS,
    websiteIdToLanguage: Map<string, string>
) {
    let requestUrl = '';
    let requestSentAtTime = new Date().getTime();
    try {
        const dataverseOrgUrl = queryParamsMap.get(Constants.ORG_URL) as string;
        requestUrl = getRequestURL(dataverseOrgUrl, entity, entityId, entitiesSchemaMap, Constants.httpMethod.GET, false);
        sendAPITelemetry(requestUrl);
        requestSentAtTime = new Date().getTime();
        const response = await fetch(requestUrl, {
            headers: getHeader(accessToken),
        });

        if (!response.ok) {
            showErrorDialog(localize("microsoft-powerapps-portals.webExtension.fetch.authorization.error", "Authorization Failed. Please run again to authorize it"), localize("microsoft-powerapps-portals.webExtension.fetch.authorization.desc", "Try again"));
            sendAPIFailureTelemetry(requestUrl, new Date().getTime() - requestSentAtTime, response.statusText);
            throw new Error(response.statusText);
        }

        sendAPISuccessTelemetry(requestUrl, new Date().getTime() - requestSentAtTime);

        const result = await response.json();
        if (dataSourcePropertiesMap.get(Constants.portalSchemaVersion) === 'V2') {
            CreateDataFileNewDataModel(result, queryParamsMap, entitiesSchemaMap, languageIdCodeMap, portalFs, dataverseOrgUrl, accessToken, entityId, websiteIdToLanguage);
        } else {
            const data = result.value;
            if (!data) {
                vscode.window.showErrorMessage(ERRORS.EMPTY_RESPONSE);
            }
            for (let counter = 0; counter < data.length; counter++) {
                createContentFiles(data[counter], entity, queryParamsMap, entitiesSchemaMap, languageIdCodeMap, portalFs, dataverseOrgUrl, accessToken, entityId, websiteIdToLanguage);
            }
        }
    } catch (error) {
        if (typeof error === "string" && error.includes('Unauthorized')) {
            vscode.window.showErrorMessage(ERRORS.AUTHORIZATION_FAILED);
        } else {
            showErrorDialog(ERRORS.INVALID_ARGUMENT, ERRORS.INVALID_ARGUMENT_DESC);
        }
        const authError = (error as Error)?.message;
        if (typeof error === "string" && error.includes("Unauthorized")) {
            showErrorDialog(localize("microsoft-powerapps-portals.webExtension.unauthorized.error", "Authorization Failed. Please run again to authorize it"), localize("microsoft-powerapps-portals.webExtension.unauthorized.desc", "There was a permissions problem with the server"));
        }
        else {
            showErrorDialog(localize("microsoft-powerapps-portals.webExtension.parameter.error", "One or more commands are invalid or malformed"), localize("microsoft-powerapps-portals.webExtension.parameter.desc", "Check the parameters and try again"));
        }
        sendAPIFailureTelemetry(requestUrl, new Date().getTime() - requestSentAtTime, authError);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CreateDataFileNewDataModel(result: any, queryParamsMap: Map<string, string>, entitiesSchemaMap: Map<string, Map<string, string>>, languageIdCodeMap: Map<string, string>, portalFs: PortalsFS, dataverseOrgUrl: string, accessToken: string, entityId: string, websiteIdToLanguage: Map<string, string>) {
    if (!result) {
        vscode.window.showErrorMessage(ERRORS.EMPTY_RESPONSE);
    }
    createContentFiles(result, Constants.powerpagecomponents, queryParamsMap, entitiesSchemaMap, languageIdCodeMap, portalFs, dataverseOrgUrl, accessToken, entityId, websiteIdToLanguage);
    return result;
}

function createContentFiles(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: any,
    entity: string,
    queryParamsMap: Map<string, string>,
    entitiesSchemaMap: Map<string, Map<string, string>>,
    languageIdCodeMap: Map<string, string>,
    portalsFS: PortalsFS,
    dataverseOrgUrl: string,
    accessToken: string,
    entityId: string,
    websiteIdToLanguage: Map<string, string>
) {
    const portalFolderName = queryParamsMap.get(Constants.WEBSITE_NAME) as string;
    const entityEntry = entitiesSchemaMap.get(Constants.pathParamToSchema.get(entity) as string);
    const exportType = entityEntry?.get('_exporttype');

    if (dataSourcePropertiesMap.get(Constants.portalSchemaVersion) as string === 'V2')
        entity = 'webpage';
    const subUri = Constants.entityFolder.get(entity) as string;

    let filePathInPortalFS = '';
    if (exportType && (exportType === Constants.exportType.SubFolders || exportType === Constants.exportType.SingleFolder)) {
        filePathInPortalFS = `${PORTALS_URI_SCHEME}:/${portalFolderName}/${subUri}/`;
        portalsFS.createDirectory(vscode.Uri.parse(filePathInPortalFS, true));
    }

    const lcid: string | undefined = websiteIdToLanguage.get(queryParamsMap.get(Constants.WEBSITE_ID) as string)
        ? websiteIdToLanguage.get(queryParamsMap.get(Constants.WEBSITE_ID) as string)
        : Constants.DEFAULT_LANGUAGE_CODE;

    const attributes = entityEntry?.get('_attributes');
    const useBase64Encoding = useBase64(entity);

    let languageCode: string = Constants.DEFAULT_LANGUAGE_CODE;

    if (languageIdCodeMap?.size && lcid) {
        languageCode = languageIdCodeMap.get(lcid) as string
            ? languageIdCodeMap.get(lcid) as string
            : Constants.DEFAULT_LANGUAGE_CODE;
    }

    if (attributes) {
        let fileName = Constants.EMPTY_FILE_NAME;
        if (dataSourcePropertiesMap.get(Constants.portalSchemaVersion) as string === 'V2')
            entity = 'powerpagecomponents';
        const fetchedFileName = entitiesSchemaMap.get(Constants.pathParamToSchema.get(entity) as string)?.get(Constants.FILE_NAME_FIELD);

        if (fetchedFileName) {
            fileName = result[fetchedFileName].toLowerCase();
        }

        if (fileName === Constants.EMPTY_FILE_NAME) {
            showErrorDialog(localize("microsoft-powerapps-portals.webExtension.file-not-found.error", "That file is not available"), localize("microsoft-powerapps-portals.webExtension.file-not-found.desc", "The metadata may have changed on the Dataverse side. Contact your admin."));
            sendErrorTelemetry(Constants.telemetryEventNames.WEB_EXTENSION_EMPTY_FILE_NAME);
            return;
        }
        if (exportType && (exportType === Constants.exportType.SubFolders)) {
            filePathInPortalFS = `${PORTALS_URI_SCHEME}:/${portalFolderName}/${subUri}/${fileName}/`;
            portalsFS.createDirectory(vscode.Uri.parse(filePathInPortalFS, true));
        }

        const attributeArray = attributes.split(',');
        const schema = queryParamsMap.get(Constants.SCHEMA) as string
        let counter = 0;

        let fileUri = '';
        for (counter; counter < attributeArray.length; counter++) {
            if (dataSourcePropertiesMap.get(Constants.portalSchemaVersion) as string === 'V2')
                entity = 'webpage';
            const fileNameWithExtension = GetFileNameWithExtension(entity,
                fileName,
                languageCode,
                Constants.columnExtension.get(attributeArray[counter]) as string);
            fileUri = filePathInPortalFS + fileNameWithExtension;

            const olddata = (JSON.parse(result.content).content) ? (JSON.parse(result.content).content) : Constants.NO_CONTENT;
            saveDataMap = createVirtualFile(
                portalsFS,
                filePathInPortalFS + fileNameWithExtension,
                olddata,
                updateEntityId(entity, entityId, entitiesSchemaMap, result),
                attributeArray[counter],
                entity,
                schema);
        }

        // Display only the last file
        vscode.window.showTextDocument(vscode.Uri.parse(fileUri));
        registerSaveProvider(accessToken, portalsFS, dataverseOrgUrl, saveDataMap, useBase64Encoding, schema);
    }
}

function createVirtualFile(
    portalsFS: PortalsFS,
    fileUri: string,
    data: JSON,
    entityId: string,
    saveDataAtribute: string,
    entity: string,
    schema: string
) {
    const saveEntityDetails = new SaveEntityDetails(entityId, entity, saveDataAtribute, schema, data);
    portalsFS.writeFile(vscode.Uri.parse(fileUri), new TextEncoder().encode(JSON.parse(data as unknown as string).copy), { create: true, overwrite: true });
    saveDataMap.set(vscode.Uri.parse(fileUri).fsPath, saveEntityDetails);
    return saveDataMap;
}

export async function getDataFromDataVerse(accessToken: string,
    entity: string,
    entityId: string,
    queryParamMap: Map<string, string>,
    entitiesSchemaMap: Map<string, Map<string, string>>,
    languageIdCodeMap: Map<string, string>,
    portalFs: PortalsFS,
    websiteIdToLanguage: Map<string, string>
) {
    vscode.window.showInformationMessage(localize("microsoft-powerapps-portals.webExtension.fetch.file.message", "Fetching your file ..."));
    await fetchData(accessToken, entity, entityId, queryParamMap, entitiesSchemaMap, languageIdCodeMap, portalFs, websiteIdToLanguage);
}
