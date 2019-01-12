import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {payment} from "./payment";


@Entity("dividend",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("creationDatetime_idx",["creationDatetime",])
@Index("originalDividendBalance_idx",["originalDividendBalance",])
export class dividend extends BaseEntity {

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
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"timeTokenSupply"
        })
    timeTokenSupply:number;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"originalDividendBalance"
        })
    originalDividendBalance:number;
        

    @Column("float",{ 
        nullable:true,
        precision:12,
        name:"houseProfit"
        })
    houseProfit:number | null;
        

    @Column("varchar",{ 
        nullable:true,
        length:45,
        name:"stakersProfit"
        })
    stakersProfit:string | null;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"dividendBalance"
        })
    dividendBalance:number;
        

    @Column("float",{ 
        nullable:false,
        precision:12,
        name:"eostimecontrRecharge"
        })
    eostimecontrRecharge:number;
        

   
    @OneToMany(type=>payment, payment=>payment.dividend_,{ onDelete: 'CASCADE' ,onUpdate: 'NO ACTION' })
    payments:payment[];
    
}
