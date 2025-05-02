// Styles suitable for appending to prompts for models without dedicated style features

const PROMPT_BASED_STYLES = [
    { name: 'None', value: '' }, // Default/No style
    { name: 'Oil Painting', value: 'Oil Painting' },
    { name: 'Watercolor', value: 'Watercolor' },
    { name: 'Sketch', value: 'Sketch' },
    { name: 'Drawing', value: 'Drawing' },
    { name: 'Anime', value: 'Anime' },
    { name: 'Cartoon', value: 'Cartoon' },
    { name: 'Comic Book', value: 'Comic Book' },
    { name: 'Low Poly', value: 'Low Poly' },
    { name: 'Pixel Art', value: 'Pixel Art' },
    { name: 'Cinematic', value: 'Cinematic' },
    { name: 'Photorealistic', value: 'Photorealistic' },
    { name: 'Fantasy Art', value: 'Fantasy Art' },
    { name: 'Digital Art', value: 'Digital Art' },
    { name: 'Abstract', value: 'Abstract' }
];

// NOTE: We might need another list here later for models that DO use LoRAs/specific styles
// const LORA_STYLES = [ ... ]; 

module.exports = {
    PROMPT_BASED_STYLES
    // LORA_STYLES 
};
