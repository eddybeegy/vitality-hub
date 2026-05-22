import { HevyModule } from "./hevy";
import { WithingsModule } from "./withings";
import { CronometerModule } from "./cronometer";
import { AppleHealthModule } from "./apple_health";
import { AppleWorkoutsModule } from "./apple_workouts";
import { NutrachekModule } from "./nutracheck";
import { StravaModule } from "./strava";
import { MyFitnessPalModule } from "./myfitnesspal";
import { DataSourceModule } from "./types";

export const modules: DataSourceModule[] = [
  AppleHealthModule,
  AppleWorkoutsModule,
  WithingsModule,
  CronometerModule,
  HevyModule,
  NutrachekModule,
  StravaModule,
  MyFitnessPalModule
];

export * from "./types";
