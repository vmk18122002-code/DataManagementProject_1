import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { Auth } from "../auth/auth.guard";
import { MODEL_ITEMS, ModelItem, PredictService } from "./predict.service";

@Controller("predict")
@Auth()
export class PredictController {
  constructor(private readonly predict: PredictService) {}

  /** Normal-time model: the areas that need the donor's packs. item = Food | Clothes | Books (any case). */
  @Get("normal")
  normal(@Query("item") item = "", @Query("qty") qty = "", @Query("location") location = "") {
    const name = MODEL_ITEMS.find((i) => i.toLowerCase() === item.toLowerCase());
    const n = Number(qty);
    if (!name) throw new BadRequestException(`item must be one of ${MODEL_ITEMS}`);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException("qty must be a whole number above 0");
    if (!location) throw new BadRequestException("location (district or DS division) is required");
    return this.predict.normal(name as ModelItem, n, location);
  }

  /** Which items the donor's district needs, by the normal model. */
  @Get("needs")
  needs(@Query("location") location = "") {
    if (!location) throw new BadRequestException("location (district or DS division) is required");
    return this.predict.needs(location);
  }
}
