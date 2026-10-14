import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import type { CreatePatientDto } from "./dto";

@Controller("patients")
export class PatientsController {
  constructor(private readonly service: { create(dto: CreatePatientDto): Promise<unknown> }) {}

  @Post()
  async create(@Body() dto: CreatePatientDto) {
    return this.service.create(dto);
  }

  @Get(":id")
  find(@Param("id") id: string) {
    return { id };
  }
}
