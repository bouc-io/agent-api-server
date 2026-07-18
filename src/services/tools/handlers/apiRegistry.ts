/**
 * API Registry - Pre-configured APIs for HTTP Request Tool
 *
 * This registry contains metadata about well-known public APIs
 * that agents can use without needing to know the full endpoint details.
 */

export interface PreConfiguredAPI {
    id: string;                    // Unique identifier (e.g., "open_meteo_weather")
    name: string;                  // Display name
    description: string;           // What the API provides
    baseUrl: string;              // Base URL for the API
    methods: string[];            // Allowed HTTP methods
    requiresAuth: boolean;        // Whether auth is needed
    rateLimit?: {
        requests: number;
        window: string;
    };
    exampleEndpoints?: {
        path: string;
        description: string;
        params?: Record<string, string>;
    }[];
}

/**
 * Registry of pre-configured APIs
 */
export const API_REGISTRY: Record<string, PreConfiguredAPI> = {
    open_meteo_weather: {
        id: 'open_meteo_weather',
        name: 'Open-Meteo Weather API',
        description: 'Free weather forecasts and current conditions worldwide. Provides temperature, precipitation, wind, and more.',
        baseUrl: 'https://api.open-meteo.com/v1',
        methods: ['GET'],
        requiresAuth: false,
        exampleEndpoints: [
            {
                path: '/forecast',
                description: 'Get weather forecast for coordinates',
                params: {
                    latitude: '45.5017',
                    longitude: '-73.5673',
                    current_weather: 'true',
                    hourly: 'temperature_2m,precipitation',
                },
            },
            {
                path: '/historical',
                description: 'Get historical weather data',
                params: {
                    latitude: '45.5017',
                    longitude: '-73.5673',
                    start_date: '2024-01-01',
                    end_date: '2024-01-31',
                    daily: 'temperature_2m_max,temperature_2m_min',
                },
            },
        ],
    },

    open_meteo_geocoding: {
        id: 'open_meteo_geocoding',
        name: 'Open-Meteo Geocoding API',
        description: 'Free geocoding service to convert location names to coordinates. Search for cities, regions, and countries.',
        baseUrl: 'https://geocoding-api.open-meteo.com/v1',
        methods: ['GET'],
        requiresAuth: false,
        exampleEndpoints: [
            {
                path: '/search',
                description: 'Search for locations by name',
                params: {
                    name: 'Montreal',
                    count: '1',
                    language: 'en',
                    format: 'json',
                },
            },
        ],
    },
};

/**
 * Get a pre-configured API by ID
 */
export function getPreConfiguredAPI(apiId: string): PreConfiguredAPI | undefined {
    return API_REGISTRY[apiId];
}

/**
 * Get all available pre-configured API IDs
 */
export function getAvailableAPIIds(): string[] {
    return Object.keys(API_REGISTRY);
}

/**
 * Check if an API ID is valid
 */
export function isValidAPIId(apiId: string): boolean {
    return apiId in API_REGISTRY;
}
