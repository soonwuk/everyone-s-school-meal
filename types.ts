export interface FoodItem {
  name: string;
  calories: string;
  description: string;
}

export interface LunchMenu {
  date: string;
  rice: FoodItem;
  soup: FoodItem;
  side1: FoodItem;
  side2: FoodItem;
  side3: FoodItem;
  dessert: FoodItem;
}

export interface School {
  SCHUL_NM: string;       // School Name
  ATPT_OFCDC_SC_CODE: string; // Office of Education Code
  SD_SCHUL_CODE: string;  // School Code
  ORG_RDNMA: string;      // Road Address
}
