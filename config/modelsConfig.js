// Configuration for Runware models and potentially others

const RUNWARE_MODELS = {
    // Text-to-Image Focused Models
    'runware:100@1': {
        name: 'Flux Schnell (runware:100@1)',
        type: 'text-to-image',
        defaultParams: { steps: 4, CFGScale: 1, scheduler: 'FlowMatchEulerDiscreteScheduler' },
        supportsStyle: false, // Doesn't support LoRAs/direct style param
        usesPromptBasedStyling: true, // Relies on appending style to prompt
        baseDimension: 1024, // Native generation dimension
        baseCostT2I: 0.00130, // Actual API cost for text-to-image
        userPriceT2I: 0.0065, // Price charged to user (5x markup)
        baseCostI2I: 0.00190, // Actual API cost for image-to-image (if supported)
        userPriceI2I: 0.0095   // Price charged to user (5x markup)
    },
    'runware:101@1': {
        name: 'Flux Dev (runware:101@1)', // Assuming this ID corresponds to Flux Dev based on user cost info
        type: 'text-to-image', // Primarily, but user provided I2I cost too
        defaultParams: { steps: 28, CFGScale: 3.5, scheduler: 'Euler' },
        supportsStyle: true, // Assumes styles are LoRAs
        usesPromptBasedStyling: false,
        baseDimension: 1024,
        baseCostT2I: 0.00320, // Actual API cost for text-to-image
        userPriceT2I: 0.0160,  // Price charged to user (5x markup)
        baseCostI2I: 0.00510, // Actual API cost for image-to-image
        userPriceI2I: 0.0255   // Price charged to user (5x markup)
    },
    'rundiffusion:130@100': {
        name: 'Playground v2.5 (rundiffusion:130@100)',
        type: 'text-to-image',
        defaultParams: { steps: 33, CFGScale: 3, scheduler: 'FlowMatchEulerDiscreteScheduler' },
        supportsStyle: false,
        baseDimension: 1024,
        baseCostT2I: 0.00260, // Estimated cost based on previous token cost relative to Flux Schnell
        userPriceT2I: 0.0130   // Price charged to user (5x markup)
        // Add I2I costs if applicable and known
    },

    // Image-to-Image / Specialized Models
    'civitai:133005@782002': {
        name: 'PhotoMaker (civitai:133005@782002)',
        type: 'image-to-image', // Primarily, but can generate from text prompts + style
        taskType: 'photoMaker', // Specific taskType for Runware API
        defaultParams: { steps: 20, CFGScale: 7.5, scheduler: 'Default', strength: 15, negativePrompt: 'deformed, blurry' },
        supportsStyle: true, // Has specific style presets
        usesPromptBasedStyling: false,
        defaultStyle: 'photographic',
        baseDimension: 1024, // Default output size
        width: 1024, // Fixed output dimensions for this model
        height: 1024,
        baseCost: 0.00130, // Actual API cost (applies to its function)
        userPrice: 0.0065   // Price charged to user (5x markup)
    },

    // Example for a potential future Img2Img model - COMMENTED OUT
    /*
    'some-img2img-model-id': {
        name: 'Generic Img2Img Model',
        type: 'image-to-image',
        defaultParams: { steps: 25, CFGScale: 5.0, scheduler: 'Euler', strength: 0.75 }, // Strength is key for img2img
        supportsStyle: false,
        baseDimension: 512, // Often lower for img2img initially
        costPerImage: 1.5 // Example cost
    }
    */
};

module.exports = {
    RUNWARE_MODELS
};
