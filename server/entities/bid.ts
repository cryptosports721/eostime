import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {user} from "./user";
import {auctions} from "./auctions";


@Entity("bid",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("fk_bid_user1_idx",["user_",])
@Index("amount_idx",["amount",])
export class bid extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"amount"
        })
    amount:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:16,
        default: () => "'EOS'",
        name:"currency"
        })
    currency:string;
        

   
    @ManyToOne(type=>user, user=>user.bs,{  nullable:false,onDelete: 'NO ACTION',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'user_id'})
    user_:user | null;


   
    @OneToMany(type=>auctions, auctions=>auctions.bid_,{ onDelete: 'NO ACTION' ,onUpdate: 'NO ACTION' })
    auctionss:auctions[];
    
}
