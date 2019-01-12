import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {dividend} from "./dividend";
import {user} from "./user";


@Entity("payment",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("fk_payment_dividend1_idx",["dividend_",])
@Index("transactionId_idx",["transactionId",])
@Index("accountName_idx",["accountName",])
@Index("paymentState_idx",["paymentState",])
@Index("creationDatetime_idx",["creationDatetime",])
@Index("currency",["currency",])
@Index("paymentType_idx",["paymentType",])
@Index("fk_payment_user1_idx",["user_",])
export class payment extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("datetime",{ 
        nullable:false,
        name:"creationDatetime"
        })
    creationDatetime:Date;
        

    @Column("enum",{ 
        nullable:false,
        default: () => "'pending'",
        enum:["pending","paid","error"],
        name:"paymentState"
        })
    paymentState:string;
        

    @Column("varchar",{ 
        nullable:false,
        length:16,
        name:"accountName"
        })
    accountName:string;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"proportion"
        })
    proportion:number | null;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"amount"
        })
    amount:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:16,
        name:"currency"
        })
    currency:string;
        

    @Column("enum",{ 
        nullable:false,
        default: () => "'house'",
        enum:["staker","house","dividend","partner","faucet","transfer"],
        name:"paymentType"
        })
    paymentType:string;
        

    @Column("varchar",{ 
        nullable:true,
        length:128,
        name:"transactionId"
        })
    transactionId:string | null;
        

    @Column("blob",{ 
        nullable:true,
        name:"error"
        })
    error:Buffer | null;
        

   
    @ManyToOne(type=>dividend, dividend=>dividend.payments,{ onDelete: 'CASCADE',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'dividend_id'})
    dividend_:dividend | null;


   
    @ManyToOne(type=>user, user=>user.payments,{ onDelete: 'NO ACTION',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'user_id'})
    user_:user | null;

}
