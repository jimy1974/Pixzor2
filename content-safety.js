require('dotenv').config();
const axios = require('axios');

// Define enums for media types, categories, and actions
class MediaType {
    static Text = 1;
    static Image = 2;
}

class Category {
    static Hate = 'Hate';
    static SelfHarm = 'SelfHarm';
    static Sexual = 'Sexual';
    static Violence = 'Violence';
}

class Action {
    static Accept = 1;
    static Reject = 2;
}

class DetectionError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.message = message;
    }

    toString() {
        return `DetectionError(code=${this.code}, message=${this.message})`;
    }
}

class Decision {
    constructor(suggestedAction, actionByCategory) {
        this.suggestedAction = suggestedAction;
        this.actionByCategory = actionByCategory;
    }
}

class ContentSafety {
    constructor(endpoint, subscriptionKey, apiVersion) {
        this.endpoint = endpoint;
        this.subscriptionKey = subscriptionKey;
        this.apiVersion = apiVersion;
    }

    buildUrl(mediaType) {
        if (mediaType === MediaType.Text) {
            return `${this.endpoint}/contentsafety/text:analyze?api-version=${this.apiVersion}`;
        } else if (mediaType === MediaType.Image) {
            return `${this.endpoint}/contentsafety/image:analyze?api-version=${this.apiVersion}`;
        } else {
            throw new Error(`Invalid Media Type ${mediaType}`);
        }
    }

    buildHeaders() {
        return {
            'Ocp-Apim-Subscription-Key': this.subscriptionKey,
            'Content-Type': 'application/json',
        };
    }

    buildRequestBody(mediaType, content, blocklists = []) {
        if (mediaType === MediaType.Text) {
            return {
                text: content,
                blocklistNames: blocklists,
            };
        } else if (mediaType === MediaType.Image) {
            return {
                image: {
                    content: content.toString('base64'),
                },
            };
        } else {
            throw new Error(`Invalid Media Type ${mediaType}`);
        }
    }

    async detect(mediaType, content, blocklists = []) {
        const url = this.buildUrl(mediaType);
        const headers = this.buildHeaders();
        const requestBody = this.buildRequestBody(mediaType, content, blocklists);

        try {
            const response = await axios.post(url, requestBody, { headers });
            console.log('Response Status:', response.status);
            console.log('Response Headers:', response.headers);
            console.log('Response Data:', response.data);

            if (response.status !== 200) {
                throw new DetectionError(response.data.error.code, response.data.error.message);
            }

            return response.data;
        } catch (error) {
            console.error('Error detecting content:', error.response?.data || error.message);
            throw error;
        }
    }

    getDetectResultByCategory(category, detectResult) {
        console.log('Looking for category:', category);
        const categoryRes = detectResult.categoriesAnalysis || [];
        for (const res of categoryRes) {
            if (category === res.category) {
                return res;
            }
        }
        throw new Error(`Invalid Category: ${category}`);
    }

    makeDecision(detectionResult, rejectThresholds) {
        const actionResult = {};
        let finalAction = Action.Accept;

        for (const [category, threshold] of Object.entries(rejectThresholds)) {
            if (![-1, 0, 2, 4, 6].includes(threshold)) {
                throw new Error('RejectThreshold can only be in (-1, 0, 2, 4, 6)');
            }

            const cateDetectRes = this.getDetectResultByCategory(category, detectionResult);

            if (!cateDetectRes || cateDetectRes.severity === undefined) {
                throw new Error(`Cannot find detection result or severity for category: ${category}`);
            }

            const severity = cateDetectRes.severity;
            const action = threshold !== -1 && severity >= threshold ? Action.Reject : Action.Accept;
            actionResult[category] = action;

            if (action > finalAction) {
                finalAction = action;
            }
        }

        if (detectionResult.blocklistsMatch && detectionResult.blocklistsMatch.length > 0) {
            finalAction = Action.Reject;
        }

        console.log('Final Action:', finalAction === Action.Accept ? 'Accept' : 'Reject');
        console.log('Action Result:', actionResult);

        return new Decision(finalAction, actionResult);
    }
}

// Export the classes and constants
module.exports = {
    MediaType,
    Category,
    Action,
    DetectionError,
    Decision,
    ContentSafety,
};