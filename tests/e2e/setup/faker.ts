import { faker } from '@faker-js/faker';

/**
 * Seed and return a shared Faker instance for deterministic data generation.
 */
export function getFaker(seed = 42) {
	faker.seed(seed);
	return faker;
}


