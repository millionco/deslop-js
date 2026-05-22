import { Controller, Get } from "./decorators";

@Controller("/users")
export class UsersController {
  @Get("/list")
  list(): string[] {
    return [];
  }
}
