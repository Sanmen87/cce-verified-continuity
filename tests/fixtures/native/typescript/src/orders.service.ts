import { Injectable } from '@nestjs/common';
import { BaseService, lookupOrder, Order } from './storage.js';

/** Finds orders using the local repository. */
@Injectable()
export class OrdersService extends BaseService {
  readonly label = 'orders';

  async findOrder(id: string): Promise<Order> {
    return lookupOrder(id);
  }
}

export const createService = () => new OrdersService();
