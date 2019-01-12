import {BaseEntity,Column,Entity,Index,JoinColumn,JoinTable,ManyToMany,ManyToOne,OneToMany,OneToOne,PrimaryColumn,PrimaryGeneratedColumn,RelationId} from "typeorm";
import {user} from "./user";


@Entity("ipAddress",{schema:"eostime"})
@Index("id_UNIQUE",["id",],{unique:true})
@Index("ipAddress_IDX",["ipAddress",])
@Index("fk_ipAddress_user_idx",["user_",])
export class ipAddress extends BaseEntity {

    @PrimaryGeneratedColumn({
        type:"int", 
        name:"id"
        })
    id:number;
        

    @Column("varchar",{ 
        nullable:false,
        length:128,
        name:"ipAddress"
        })
    ipAddress:string;
        

    @Column("int",{ 
        nullable:false,
        default: () => "'1'",
        name:"connectionCount"
        })
    connectionCount:number;
        

   
    @ManyToOne(type=>user, user=>user.ipAddresss,{ primary:true, nullable:false,onDelete: 'NO ACTION',onUpdate: 'NO ACTION' })
    @JoinColumn({ name:'user_id'})
    user_:user | null;

}
